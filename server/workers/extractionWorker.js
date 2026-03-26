'use strict';

/**
 * extractionWorker.js — Node.js Worker Thread
 *
 * Receives via workerData:
 *   {
 *     extractionId: string (UUID),
 *     filePath:     string,
 *     fileName:     string,
 *     fileType:     string,   // lowercase extension without dot: 'pdf','docx','txt', …
 *     orgId:        number,
 *     projectId:    number|null,
 *   }
 *
 * Lifecycle:
 *   1. Update extraction_status → 'pending' (already set on insert, but confirms worker started)
 *   2. Extract text from file based on fileType
 *   3. Sanitise extracted text (prompt-injection patterns)
 *   4. Persist extracted_text + status='complete' in document_extractions
 *   5. Chunk text → embed each chunk via Google text-embedding-004
 *   6. Bulk-insert chunks into document_embeddings
 *   7. On any error: set extraction_status='failed', error_message
 *
 * The worker creates its own pg Pool — Worker Threads don't share module
 * instances with the main thread.
 */

require('dotenv').config({ path: '../../.env' });

const { workerData, parentPort } = require('worker_threads');
const path = require('path');
const fs   = require('fs');
const { Pool } = require('pg');
const { chunkText }    = require('../services/chunkingService');
const { embedBatch }   = require('../services/embeddingService');

// ---------------------------------------------------------------------------
// DB pool — scoped to this worker thread
// ---------------------------------------------------------------------------
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// Prompt-injection sanitiser
// Strips patterns that could manipulate an LLM if the extracted text is later
// included verbatim in a system or user prompt.
// ---------------------------------------------------------------------------
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /\bsystem\s*:/gi,
  /\bassistant\s*:/gi,
  /\bai\s*:/gi,
  /<\s*\/?system\s*>/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<<SYS>>/gi,
  /<\/SYS>/gi,
  /\bforget\s+(everything|all|prior|previous)/gi,
  /\bdisregard\s+(all\s+)?(previous|prior|above)/gi,
  /\byou\s+are\s+now\s+a/gi,
  /\bact\s+as\s+(if\s+you\s+are|a\s+)/gi,
  /\bjailbreak/gi,
  /\bDAN\b/g,
];

function sanitise(text) {
  let out = text;
  for (const pattern of INJECTION_PATTERNS) {
    out = out.replace(pattern, '[REMOVED]');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extractor implementations
// ---------------------------------------------------------------------------

async function extractPdf(filePath) {
  const pdfParse = require('pdf-parse');
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

async function extractDocx(filePath) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

async function extractXlsx(filePath) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const csvParts = [];
  workbook.eachSheet((worksheet) => {
    const rows = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        // Normalise cell value to a plain string
        let v = cell.value;
        if (v === null || v === undefined) {
          v = '';
        } else if (typeof v === 'object' && v.result !== undefined) {
          // Formula cell — use computed result
          v = v.result;
        } else if (typeof v === 'object' && v.text !== undefined) {
          // Rich text
          v = v.text;
        }
        values.push(String(v).replace(/,/g, ' ').replace(/\n/g, ' '));
      });
      rows.push(values.join(','));
    });
    csvParts.push(`--- Sheet: ${worksheet.name} ---\n${rows.join('\n')}`);
  });

  return csvParts.join('\n\n');
}

async function extractPlain(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

async function extract(fileType, filePath) {
  switch (fileType) {
    case 'pdf':                   return extractPdf(filePath);
    case 'docx':                  return extractDocx(filePath);
    case 'xlsx': case 'xls':      return extractXlsx(filePath);
    default:                      return extractPlain(filePath);
  }
}

// ---------------------------------------------------------------------------
// Main worker logic
// ---------------------------------------------------------------------------

async function run() {
  const { extractionId, filePath, fileName, fileType, orgId, projectId } = workerData;

  let client;
  try {
    client = await pool.connect();

    // -- Extract ---------------------------------------------------------------
    let rawText;
    try {
      rawText = await extract(fileType, filePath);
    } catch (extractErr) {
      await client.query(
        `UPDATE document_extractions
            SET extraction_status = 'failed',
                error_message     = $1,
                updated_at        = NOW()
          WHERE id = $2`,
        [extractErr.message, extractionId]
      );
      parentPort?.postMessage({ status: 'failed', extractionId, error: extractErr.message });
      return;
    }

    const cleanText = sanitise(rawText);

    // -- Persist extracted text -----------------------------------------------
    await client.query(
      `UPDATE document_extractions
          SET extracted_text    = $1,
              extraction_status = 'complete',
              updated_at        = NOW()
        WHERE id = $2`,
      [cleanText, extractionId]
    );

    // -- Chunk -----------------------------------------------------------------
    const chunks = chunkText(cleanText);

    if (chunks.length === 0) {
      parentPort?.postMessage({ status: 'complete', extractionId, chunks: 0 });
      return;
    }

    // -- Embed -----------------------------------------------------------------
    let embeddings;
    try {
      embeddings = await embedBatch(chunks);
    } catch (embedErr) {
      // Extraction succeeded; only embedding failed — record warning, not failure
      await client.query(
        `UPDATE document_extractions
            SET error_message = $1,
                updated_at    = NOW()
          WHERE id = $2`,
        [`Embedding failed: ${embedErr.message}`, extractionId]
      );
      parentPort?.postMessage({
        status: 'complete_no_embedding',
        extractionId,
        chunks: chunks.length,
        error: embedErr.message,
      });
      return;
    }

    // -- Store chunks ----------------------------------------------------------
    // Use a single multi-value INSERT for efficiency.
    // Build parameterised query: each row is 7 values.
    const valuePlaceholders = [];
    const params = [];
    let p = 1;

    for (let i = 0; i < chunks.length; i++) {
      valuePlaceholders.push(
        `(gen_random_uuid(), $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}::vector)`
      );
      params.push(
        extractionId,
        orgId,
        projectId ?? null,
        i,
        chunks[i],
        JSON.stringify(embeddings[i])
      );
    }

    await client.query(
      `INSERT INTO document_embeddings
         (id, extraction_id, org_id, project_id, chunk_index, chunk_text, embedding)
       VALUES ${valuePlaceholders.join(', ')}`,
      params
    );

    parentPort?.postMessage({ status: 'complete', extractionId, chunks: chunks.length });

  } catch (err) {
    // Unexpected top-level failure
    try {
      await client?.query(
        `UPDATE document_extractions
            SET extraction_status = 'failed',
                error_message     = $1,
                updated_at        = NOW()
          WHERE id = $2`,
        [err.message, extractionId]
      );
    } catch { /* swallow — pool may be gone */ }

    parentPort?.postMessage({ status: 'failed', extractionId, error: err.message });
  } finally {
    client?.release();
    await pool.end();
  }
}

run();
