'use strict';

/**
 * SearchService — permission-aware global vector search.
 *
 * Security model:
 *   Permitted resource IDs are resolved BEFORE the query executes.
 *   Post-query filtering is forbidden — all access control happens in SQL.
 *
 * Scopes:
 *   'projects' — requires explicit project membership (or org_admin)
 *   'files'    — org-scoped only, no resource-level restriction
 *   'general'  — org-scoped only, no resource-level restriction
 *
 * Self-contained by design: does not import embeddingService.
 * Duplicating the minimal embedding call avoids a fragile service chain.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { pool }                = require('../db');

const REGISTERED_TOOLS = ['projects', 'files', 'general'];

let _aiClient = null;

function getAIClient() {
  if (!_aiClient) {
    _aiClient = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  }
  return _aiClient;
}

/**
 * Embed a query string using Google text-embedding-004.
 * Exported so the search route can embed before calling globalSearch.
 *
 * @param {string} text
 * @returns {Promise<number[]>} 768-dimensional vector
 */
async function embedQuery(text) {
  const model  = getAIClient().getGenerativeModel({ model: 'text-embedding-004' });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

/**
 * Execute a permission-aware vector search across all org content.
 *
 * @param {number}   orgId
 * @param {number}   userId
 * @param {string}   userRole        'org_admin' | 'member'
 * @param {number[]} queryEmbedding  768-dim vector from embedQuery()
 * @param {object}   options
 * @param {number}   [options.limit=10]         Max results (capped by caller)
 * @param {string[]|null} [options.toolScopes]  Scope filter; null = all scopes
 * @returns {Promise<Array<{id, tool_scope, resource_id, content_preview, similarity_score}>>}
 */
async function globalSearch(orgId, userId, userRole, queryEmbedding, options = {}) {
  const { limit = 10, toolScopes = null } = options;

  // -------------------------------------------------------------------------
  // Step 1 — Resolve permitted tool scopes
  // -------------------------------------------------------------------------
  let permittedScopes = toolScopes != null
    ? toolScopes.filter(s => REGISTERED_TOOLS.includes(s))
    : [...REGISTERED_TOOLS];

  if (permittedScopes.length === 0) return [];

  // -------------------------------------------------------------------------
  // Step 2 — Resolve permitted resource IDs per scope
  // -------------------------------------------------------------------------
  let permittedProjectIds = [];

  if (permittedScopes.includes('projects')) {
    if (userRole === 'org_admin') {
      const result = await pool.query(
        `SELECT id FROM projects WHERE org_id = $1 AND status = 'active'`,
        [orgId]
      );
      permittedProjectIds = result.rows.map(r => r.id);
    } else {
      const result = await pool.query(
        `SELECT project_id FROM project_members WHERE user_id = $1 AND org_id = $2`,
        [userId, orgId]
      );
      permittedProjectIds = result.rows.map(r => r.project_id);
    }

    // Remove 'projects' entirely if the user has no permitted projects.
    // This prevents an empty ANY($) array from reaching the query.
    if (permittedProjectIds.length === 0) {
      permittedScopes = permittedScopes.filter(s => s !== 'projects');
    }
  }

  // If scope removal left nothing to search, return early.
  if (permittedScopes.length === 0) return [];

  // -------------------------------------------------------------------------
  // Step 3 — Single vector search query with conditional scope enforcement.
  //
  // WHERE logic:
  //   org_id = $1                          — hard tenant boundary, always first
  //   tool_scope = ANY($2)                 — only permitted scopes
  //   tool_scope != 'projects'             — files/general: no resource check
  //   OR resource_id = ANY($3::uuid[])     — projects: must be in permitted list
  //
  // One query, no application-level union.
  // -------------------------------------------------------------------------
  const result = await pool.query(
    `SELECT
       de.id,
       de.tool_scope,
       de.resource_id,
       LEFT(de.chunk_text, 200) AS content_preview,
       1 - (de.embedding <=> $4::vector)  AS similarity_score
     FROM document_embeddings de
     WHERE de.org_id = $1
       AND de.tool_scope = ANY($2)
       AND (
             de.tool_scope != 'projects'
             OR de.resource_id = ANY($3::uuid[])
           )
     ORDER BY de.embedding <=> $4::vector
     LIMIT $5`,
    [orgId, permittedScopes, permittedProjectIds, JSON.stringify(queryEmbedding), limit]
  );

  // -------------------------------------------------------------------------
  // Step 4 — Return results. org_id is structurally absent from all objects.
  // -------------------------------------------------------------------------
  return result.rows.map(r => ({
    id:               r.id,
    tool_scope:       r.tool_scope,
    resource_id:      r.resource_id,
    content_preview:  r.content_preview,
    similarity_score: parseFloat(r.similarity_score),
  }));
}

module.exports = { globalSearch, embedQuery };
