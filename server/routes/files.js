'use strict';

/**
 * /api/files — file ingestion, serving, and semantic search.
 *
 * POST   /api/files/upload        Upload a file; triggers background extraction
 * GET    /api/files/:fileId        Serve the raw file (auth + permission gated)
 * POST   /api/files/search         Semantic similarity search over stored chunks
 *
 * Access model:
 *   requireAuth resolves req.user (id, email, org_id)
 *   All DB reads are filtered by req.user.org_id — cross-org leakage is impossible.
 *   PermissionService.isOrgAdmin() used to gate upload/search to org members;
 *   org_member role is sufficient (matches the floor established in stream.js).
 */

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const multer     = require('multer');
const rateLimit  = require('express-rate-limit');
const { Worker } = require('worker_threads');

const { pool }              = require('../db');
const { requireAuth }       = require('../middleware/requireAuth');
const PermissionService     = require('../services/permissions');
const { embedText }         = require('../services/embeddingService');
const { recordEvent }       = require('../services/telemetryService');
const logger                = require('../utils/logger');

const router = express.Router();

// ---------------------------------------------------------------------------
// Rate limiters — keyed by authenticated user ID (not IP).
// Keying by user ID is correct for a multi-tenant SaaS: users behind the same
// corporate proxy share an IP but must have independent limits.
//
// NOTE: State is in-memory and resets on server restart.
// For production scale, replace the default MemoryStore with a Redis store
// (e.g. rate-limit-redis) so limits survive deploys and scale across instances.
// ---------------------------------------------------------------------------

const uploadLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,  // 1 hour
  max:             20,
  keyGenerator:    (req) => String(req.user.id),
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Upload limit reached. Try again later.' },
  // skip: undefined — all authenticated requests are counted
});

const searchLimiter = rateLimit({
  windowMs:        10 * 60 * 1000,  // 10 minutes
  max:             60,
  keyGenerator:    (req) => String(req.user.id),
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Search limit reached. Try again later.' },
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const FILE_SIZE_LIMIT = 500 * 1024; // 500 KB

const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'docx', 'txt', 'md', 'csv', 'json',
  'xlsx', 'js', 'jsx', 'ts', 'tsx', 'py', 'php',
  'css', 'html', 'sql', 'sh',
]);

// MIME types accepted by multer (belt-and-suspenders alongside extension check)
const ALLOWED_MIME_PREFIXES = [
  'text/',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument',
  'application/vnd.ms-excel',
  'application/json',
  'application/octet-stream', // some browsers send this for code files
];

const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');

const WORKER_PATH = path.join(__dirname, '..', 'workers', 'extractionWorker.js');

// ---------------------------------------------------------------------------
// Multer — disk storage scoped to org + project
// ---------------------------------------------------------------------------

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const orgId     = String(req.user.org_id);
    const projectId = req.body.project_id ? String(req.body.project_id) : '_root';
    const dir = path.join(UPLOADS_ROOT, orgId, projectId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    // Prefix with a random hex slug to avoid collisions and prevent path traversal
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const prefix   = crypto.randomBytes(8).toString('hex');
    cb(null, `${prefix}_${safeName}`);
  },
});

function multerFileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname).replace('.', '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Extension .${ext} not allowed`));
  }
  const mimeOk = ALLOWED_MIME_PREFIXES.some(p => file.mimetype.startsWith(p));
  if (!mimeOk) {
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `MIME type ${file.mimetype} not allowed`));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  limits: { fileSize: FILE_SIZE_LIMIT },
  fileFilter: multerFileFilter,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Verify the authenticated user belongs to the org that owns the extraction. */
async function assertOwnership(extractionId, orgId) {
  const result = await pool.query(
    `SELECT id, file_path FROM document_extractions WHERE id = $1 AND org_id = $2`,
    [extractionId, orgId]
  );
  return result.rows[0] ?? null;
}

/** Spawn extraction worker and log outcome — fire-and-forget from the route. */
function spawnExtractionWorker(workerData) {
  const worker = new Worker(WORKER_PATH, { workerData });

  worker.on('message', (msg) => {
    logger.info('extraction worker message', msg);

    // Record embedding_generated event once the worker signals completion.
    // chunk_count comes from the worker's postMessage payload.
    // Fire-and-forget — void, no await.
    if (msg.status === 'complete' || msg.status === 'complete_no_embedding') {
      void recordEvent(workerData.orgId, workerData.userId, 'embedding_generated', {
        chunkCount:     msg.chunks ?? 0,
        embeddingModel: 'text-embedding-004',
      });
    }
  });

  worker.on('error', (err) => {
    logger.error('extraction worker error', { error: err.message, extractionId: workerData.extractionId });
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      logger.warn('extraction worker exited with non-zero code', {
        code,
        extractionId: workerData.extractionId,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// POST /api/files/upload
// ---------------------------------------------------------------------------

router.post('/upload', requireAuth, uploadLimiter, upload.single('file'), async (req, res) => {
  // multer errors are caught by the error-handling middleware below,
  // but file-filter rejections arrive here as MulterError on req — see handler.

  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const projectId = req.body.project_id ? Number(req.body.project_id) : null;
  const ext       = path.extname(req.file.originalname).replace('.', '').toLowerCase();

  let extractionId;
  try {
    const result = await pool.query(
      `INSERT INTO document_extractions
         (org_id, project_id, file_name, file_type, file_path, extraction_status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id`,
      [req.user.org_id, projectId, req.file.originalname, ext, req.file.path]
    );
    extractionId = result.rows[0].id;
  } catch (err) {
    logger.error('upload: DB insert failed', { error: err.message });
    // Clean up the orphaned upload
    fs.unlink(req.file.path, () => {});
    return res.status(500).json({ error: 'Failed to register upload' });
  }

  // Fire-and-forget extraction worker
  spawnExtractionWorker({
    extractionId,
    filePath:  req.file.path,
    fileName:  req.file.originalname,
    fileType:  ext,
    orgId:     req.user.org_id,
    userId:    req.user.id,
    projectId: projectId,
  });

  logger.info('file uploaded', {
    extractionId,
    fileName: req.file.originalname,
    size: req.file.size,
    orgId: req.user.org_id,
  });

  // Telemetry: record file_upload event — fire-and-forget, void/no await.
  void recordEvent(req.user.org_id, req.user.id, 'file_upload', { fileType: ext });

  return res.status(202).json({
    extractionId,
    fileName:  req.file.originalname,
    fileType:  ext,
    status:    'pending',
    message:   'File accepted. Extraction running in background.',
  });
});

// ---------------------------------------------------------------------------
// GET /api/files/:extractionId/status — extraction progress polling
// ---------------------------------------------------------------------------
// Returns 404 (not 403) for cross-org requests — avoids confirming that a
// given extraction_id exists in another organisation's data.

router.get('/:extractionId/status', requireAuth, async (req, res) => {
  const { extractionId } = req.params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(extractionId)) {
    return res.status(400).json({ error: 'Invalid extraction ID' });
  }

  try {
    const result = await pool.query(
      `SELECT
         ex.id,
         ex.file_name,
         ex.extraction_status,
         ex.created_at,
         COUNT(de.id)::int AS chunk_count
       FROM document_extractions ex
       LEFT JOIN document_embeddings de ON de.extraction_id = ex.id
       WHERE ex.id = $1
         AND ex.org_id = $2
       GROUP BY ex.id, ex.file_name, ex.extraction_status, ex.created_at`,
      [extractionId, req.user.org_id]
    );

    // Return 404 whether the record doesn't exist OR belongs to a different org —
    // never leak cross-org existence information.
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Extraction not found' });
    }

    const row = result.rows[0];
    return res.json({
      id:                row.id,
      fileName:          row.file_name,
      extractionStatus:  row.extraction_status,
      chunkCount:        row.chunk_count,
      createdAt:         row.created_at,
    });
  } catch (err) {
    logger.error('status: query failed', { error: err.message, extractionId });
    return res.status(500).json({ error: 'Failed to fetch extraction status' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/files/:fileId — serve the raw file
// ---------------------------------------------------------------------------

router.get('/:fileId', requireAuth, async (req, res) => {
  const { fileId } = req.params;

  // Validate UUID format to prevent DB errors
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId)) {
    return res.status(400).json({ error: 'Invalid file ID' });
  }

  const row = await assertOwnership(fileId, req.user.org_id);
  if (!row) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Additional permission check — org_admin or org_member required
  const isAdmin  = await PermissionService.isOrgAdmin(req.user.id);
  const isMember = await PermissionService.hasRole(req.user.id, ['org_member']);
  if (!isAdmin && !isMember) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  if (!fs.existsSync(row.file_path)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  return res.sendFile(path.resolve(row.file_path));
});

// ---------------------------------------------------------------------------
// POST /api/files/search — scoped semantic similarity search
//
// Security contract (two layers — both must pass):
//   Layer 1 — PermissionService: caller must be org_admin or org_member.
//   Layer 2 — SQL: WHERE de.org_id = $1 is a hard constraint in every query;
//             results from other orgs are structurally unreachable.
//
// Sprint 3 hook: embedText() + pool.query() are isolated in executeSearch()
// so cost telemetry can wrap this function without restructuring the route.
// ---------------------------------------------------------------------------

/**
 * Core search query — isolated for Sprint 3 telemetry wrapping.
 * All parameters are already validated and permission-checked by the caller.
 *
 * @param {object} opts
 * @param {number}      opts.orgId
 * @param {number|null} opts.projectId
 * @param {number[]}    opts.queryEmbedding
 * @param {number}      opts.topK
 * @returns {Promise<object[]>}
 */
async function executeSearch({ orgId, projectId, queryEmbedding, topK }) {
  // org_id is ALWAYS enforced at the SQL level — this is not application-logic-only.
  // project_id filter is added as a second SQL predicate when provided.
  const projectFilter = projectId != null ? 'AND de.project_id = $4' : '';
  const params = projectId != null
    ? [orgId, JSON.stringify(queryEmbedding), topK, projectId]
    : [orgId, JSON.stringify(queryEmbedding), topK];

  const sql = `
    SELECT
      de.id,
      de.extraction_id,
      de.chunk_index,
      de.chunk_text,
      1 - (de.embedding <=> $2::vector) AS similarity_score,
      ex.file_name,
      ex.file_type
    FROM document_embeddings de
    JOIN document_extractions ex ON ex.id = de.extraction_id
    WHERE de.org_id = $1
      ${projectFilter}
      AND ex.extraction_status = 'complete'
    ORDER BY de.embedding <=> $2::vector
    LIMIT $3
  `;

  const result = await pool.query(sql, params);
  // org_id is intentionally excluded from the mapped output — never expose it.
  return result.rows.map(r => ({
    id:             r.id,
    extractionId:   r.extraction_id,
    chunkIndex:     r.chunk_index,
    chunkText:      r.chunk_text,
    similarityScore: Number(Number(r.similarity_score).toFixed(4)),
    fileName:       r.file_name,
    fileType:       r.file_type,
  }));
}

router.post('/search', requireAuth, searchLimiter, async (req, res) => {
  const { query, project_id, top_k = 5 } = req.body;

  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'query is required' });
  }

  const topK = Math.min(Math.max(Number(top_k) || 5, 1), 50);

  // -- Layer 1: PermissionService check --------------------------------------
  // Equivalent to hasPermission(req.user, 'files', 'search'):
  // org_admin satisfies all permission checks; org_member is the access floor.
  // Fail closed — no fallback to unscoped search.
  let hasAccess = false;
  try {
    hasAccess = await PermissionService.isOrgAdmin(req.user.id) ||
                await PermissionService.hasRole(req.user.id, ['org_member']);
  } catch (err) {
    logger.error('search: permission check failed', { error: err.message });
    return res.status(500).json({ error: 'Permission check failed' });
  }

  if (!hasAccess) {
    return res.status(403).json({ error: 'You do not have permission to search files' });
  }

  // -- Project access verification -------------------------------------------
  // If a project_id is supplied, confirm it belongs to this org before scoping
  // the search to it. A project_id from a different org must return 403, not
  // silently empty results — fail closed.
  let resolvedProjectId = null;
  if (project_id != null) {
    resolvedProjectId = Number(project_id);
    if (!Number.isFinite(resolvedProjectId)) {
      return res.status(400).json({ error: 'project_id must be a number' });
    }

    try {
      const projectCheck = await pool.query(
        `SELECT 1 FROM document_extractions
          WHERE project_id = $1 AND org_id = $2
          LIMIT 1`,
        [resolvedProjectId, req.user.org_id]
      );
      if (projectCheck.rows.length === 0) {
        // Either the project doesn't exist in this org, or it belongs to another —
        // return 403 either way; don't confirm or deny existence.
        return res.status(403).json({ error: 'Access to the requested project is denied' });
      }
    } catch (err) {
      logger.error('search: project check failed', { error: err.message });
      return res.status(500).json({ error: 'Project verification failed' });
    }
  }

  // -- Embed query -----------------------------------------------------------
  let queryEmbedding;
  try {
    queryEmbedding = await embedText(query.trim());
  } catch (err) {
    logger.error('search: embedding failed', { error: err.message });
    return res.status(502).json({ error: 'Embedding service unavailable' });
  }

  // -- Execute search + fire-and-forget telemetry ----------------------------
  // start/end timing wraps executeSearch() only — not the embedding call —
  // so duration_ms reflects pure DB retrieval time, useful for index tuning.
  const searchStart = Date.now();
  try {
    const results = await executeSearch({
      orgId:          req.user.org_id,
      projectId:      resolvedProjectId,
      queryEmbedding,
      topK,
    });

    // Telemetry: fire-and-forget, void/no await — a slow write must not delay
    // the response. query_tokens approximates token count as chars / 4.
    void recordEvent(req.user.org_id, req.user.id, 'file_search', {
      queryTokens:    Math.ceil(query.trim().length / 4),
      resultCount:    results.length,
      durationMs:     Date.now() - searchStart,
    });

    return res.json({ query, results });

  } catch (err) {
    logger.error('search: query failed', { error: err.message });
    return res.status(500).json({ error: 'Search failed' });
  }
});

// ---------------------------------------------------------------------------
// Multer error handler — must be defined after all routes in this router
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File exceeds 500 KB limit' });
    }
    return res.status(400).json({ error: err.message });
  }
  logger.error('files router error', { error: err.message });
  return res.status(500).json({ error: 'File operation failed' });
});

module.exports = router;
