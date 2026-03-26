'use strict';

/**
 * ToolRegistry — platform-level tool management service.
 *
 * Every agent module calls toolRegistry.getAvailableTools(context) to discover
 * what tools it may use. Platform tools (web_search, query_knowledge_base,
 * send_email) are registered here at module load. Domain-specific tools
 * (e.g. ads-specific tools) register themselves at their own module load
 * and are automatically included once registered.
 *
 * Usage:
 *   const { toolRegistry } = require('../services/ToolRegistry');
 *   const tools = await toolRegistry.getAvailableTools(context);
 *   // pass tools to AgentOrchestrator.run({ tools, ... })
 *
 * Or with a custom logger:
 *   const { ToolRegistry } = require('../services/ToolRegistry');
 *   const registry = new ToolRegistry({ logger: myLogger });
 */

const defaultLogger       = require('../utils/logger');
const PermissionService   = require('./permissions');
const { globalSearch, embedQuery } = require('./searchService');
const { send: sendEmail } = require('./email');

// ─── ValidationError ──────────────────────────────────────────────────────────

/**
 * Thrown by execute() when input fails schema validation.
 * Carries the offending field name and tool name for structured error handling.
 */
class ValidationError extends Error {
  /**
   * @param {string} message
   * @param {object} [details]
   * @param {string|null} [details.field]    - The input field that failed validation
   * @param {string|null} [details.toolName] - The tool whose schema was violated
   */
  constructor(message, { field, toolName } = {}) {
    super(message);
    this.name = 'ValidationError';
    this.field    = field    ?? null;
    this.toolName = toolName ?? null;
  }
}

// ─── ToolRegistry ─────────────────────────────────────────────────────────────

class ToolRegistry {
  /**
   * @param {object} [options]
   * @param {object} [options.logger] - Winston-compatible logger. Defaults to the platform logger.
   */
  constructor({ logger: customLogger, permissionService: customPermissionService } = {}) {
    this._tools = new Map(); // name → full toolDef (including execute)
    this.logger = customLogger ?? defaultLogger;
    this.permissionService = customPermissionService ?? PermissionService;
  }

  // ── register ─────────────────────────────────────────────────────────────────

  /**
   * Add a tool to the registry. Called at startup — not at request time.
   *
   * Tool definition shape:
   *   {
   *     name:                 string,        // snake_case identifier
   *     description:          string,        // shown to Claude
   *     input_schema:         object,        // Anthropic JSON schema format
   *     execute:              async fn,      // (input, context) => JSON-serialisable
   *     requiredPermissions:  string[],      // role names; [] = available to all
   *     toolSlug:             string|null,   // if set, scoped to that tool only
   *   }
   *
   * @param {object} toolDef
   * @throws {Error} If required fields are missing — startup-time guard, not ValidationError.
   */
  register(toolDef) {
    const name = toolDef?.name ?? '(unknown)';

    for (const field of ['name', 'description', 'input_schema']) {
      if (!toolDef[field]) {
        throw new Error(`ToolRegistry.register: missing required field "${field}" on tool "${name}"`);
      }
    }
    if (typeof toolDef.execute !== 'function') {
      throw new Error(`ToolRegistry.register: "execute" must be a function on tool "${name}"`);
    }

    if (this._tools.has(toolDef.name)) {
      this.logger.warn('ToolRegistry: overwriting existing tool registration', {
        toolName: toolDef.name,
      });
    }

    this._tools.set(toolDef.name, {
      ...toolDef,
      requiredPermissions: toolDef.requiredPermissions ?? [],
      toolSlug:            toolDef.toolSlug            ?? null,
    });

    this.logger.info('ToolRegistry: registered tool', { toolName: toolDef.name });
  }

  // ── getAvailableTools ────────────────────────────────────────────────────────

  /**
   * Return the tools this caller is permitted to use.
   *
   * Filtering rules (applied in order):
   *   1. toolSlug scope  — if tool.toolSlug is set, the tool is only included when
   *                        context.toolSlug matches exactly. This is a security boundary:
   *                        ads-specific tools must never appear in a research agent's
   *                        tool list, even if the user holds the right roles.
   *   2. Permissions     — if requiredPermissions is empty, include unconditionally.
   *                        Otherwise call PermissionService.hasRole() for the full list;
   *                        include if the user holds ANY of the listed roles.
   *   3. Permission check failure — catch and exclude the tool (fail closed).
   *
   * Returns tool objects with execute intact — AgentOrchestrator strips execute
   * itself before sending schemas to Claude and uses the full objects for dispatch.
   *
   * @param {{ userId: number, orgId: number, toolSlug: string }} context
   * @returns {Promise<Array>}
   */
  async getAvailableTools(context) {
    const available = [];

    for (const tool of this._tools.values()) {
      // ── Security boundary: toolSlug scoping ─────────────────────────────────
      // A tool with a toolSlug set is scoped exclusively to that agent/tool.
      // Mismatched slugs are silently excluded — not an error condition.
      if (tool.toolSlug !== null && tool.toolSlug !== context.toolSlug) {
        continue;
      }

      // ── Permission check ────────────────────────────────────────────────────
      if (tool.requiredPermissions.length === 0) {
        available.push(tool);
        continue;
      }

      try {
        // Global scope (null): platform tool permissions are org-wide, not tool-scoped.
        // Future tool-scoped permissions should pass { type: 'tool', id: context.toolSlug }.
        const permitted = await this.permissionService.hasRole(
          context.userId,
          tool.requiredPermissions,
          null
        );
        if (permitted) available.push(tool);
      } catch (err) {
        // Fail closed: a broken permission check excludes the tool rather than
        // granting access to an unchecked capability.
        this.logger.warn('ToolRegistry: permission check failed — excluding tool', {
          toolName: tool.name,
          userId:   context.userId,
          error:    err.message,
        });
      }
    }

    return available;
  }

  // ── execute ──────────────────────────────────────────────────────────────────

  /**
   * Validate input and execute a named tool directly.
   *
   * This is used by routes or tests that want to invoke a single tool without
   * running a full ReAct loop. AgentOrchestrator dispatches tool calls itself
   * via tool.execute() after receiving the array from getAvailableTools().
   *
   * Tool execution errors are caught and returned as { error } — consistent
   * with AgentOrchestrator's per-tool error handling. Callers decide how to
   * surface them.
   *
   * @param {string} toolName
   * @param {object} input
   * @param {{ userId: number, orgId: number, toolSlug: string }} context
   * @returns {Promise<object>}
   * @throws {ValidationError} If context.orgId is missing, tool not found, or input invalid.
   */
  async execute(toolName, input, context) {
    if (!context?.orgId) {
      throw new ValidationError('context.orgId is required', { toolName });
    }

    const tool = this._tools.get(toolName);
    if (!tool) {
      throw new ValidationError(`Tool not found: ${toolName}`, { toolName });
    }

    // Throws ValidationError on failure — surfaces to caller before execution.
    this._validateInput(tool, input);

    try {
      return await tool.execute(input, context);
    } catch (err) {
      this.logger.warn('ToolRegistry: tool execution error', {
        toolName,
        error:  err.message,
        orgId:  context.orgId,
        userId: context.userId,
      });
      return { error: err.message ?? 'Tool execution failed' };
    }
  }

  // ── getSchema ─────────────────────────────────────────────────────────────────

  /**
   * Return the Anthropic-compatible schema for a tool — strips execute,
   * requiredPermissions, and toolSlug. Safe to send to the Claude API directly.
   *
   * @param {string} toolName
   * @returns {{ name: string, description: string, input_schema: object } | null}
   */
  getSchema(toolName) {
    const tool = this._tools.get(toolName);
    if (!tool) return null;
    const { name, description, input_schema } = tool;
    return { name, description, input_schema };
  }

  // ── listAll ───────────────────────────────────────────────────────────────────

  /**
   * Return all registered tools including execute functions. Admin use only.
   * Callers are responsible for not exposing execute to external consumers.
   *
   * @returns {Array}
   */
  listAll() {
    return Array.from(this._tools.values());
  }

  // ── private: _validateInput ───────────────────────────────────────────────────

  /**
   * Validate input against a tool's input_schema.
   * Checks required fields and type constraints on present fields.
   * Does not validate nested schemas, oneOf, anyOf, or format constraints.
   *
   * @param {object} tool
   * @param {*}      input
   * @throws {ValidationError}
   */
  _validateInput(tool, input) {
    const schema   = tool.input_schema;
    const toolName = tool.name;

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new ValidationError('input must be a plain object', { toolName });
    }

    // Required field presence
    for (const field of (schema.required ?? [])) {
      if (input[field] === undefined || input[field] === null) {
        throw new ValidationError(
          `Missing required field: "${field}"`,
          { field, toolName }
        );
      }
    }

    // Type constraints on present fields
    for (const [field, fieldSchema] of Object.entries(schema.properties ?? {})) {
      if (input[field] === undefined) continue; // optional, not provided — fine
      const expected = fieldSchema.type;
      if (!expected) continue;

      const valid =
        expected === 'string'  ? typeof input[field] === 'string'  :
        expected === 'number'  ? typeof input[field] === 'number'  :
        expected === 'boolean' ? typeof input[field] === 'boolean' :
        expected === 'array'   ? Array.isArray(input[field])       :
        expected === 'object'  ? (
          input[field] !== null &&
          typeof input[field] === 'object' &&
          !Array.isArray(input[field])
        ) : true; // unknown type — skip

      if (!valid) {
        throw new ValidationError(
          `Field "${field}" must be of type ${expected}`,
          { field, toolName }
        );
      }
    }
  }
}

// ─── Built-in Platform Tools ──────────────────────────────────────────────────

/**
 * web_search
 * Search the web via the Brave Search API (SEARCH_API_KEY).
 * Available to all authenticated users — no role required.
 */
const webSearchTool = {
  name: 'web_search',
  description:
    'Search the web for current information. ' +
    'Returns titles, URLs, and descriptions of matching pages.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query.',
      },
      maxResults: {
        type: 'number',
        description: 'Number of results to return (1–10). Defaults to 5.',
      },
    },
    required: ['query'],
  },
  requiredPermissions: [],
  toolSlug: null,

  async execute(input, _context) {
    const apiKey = process.env.SEARCH_API_KEY;
    if (!apiKey) {
      return { error: 'Web search is not configured (SEARCH_API_KEY missing)' };
    }

    const count = Math.min(Math.max(1, input.maxResults ?? 5), 10);
    const url   = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(input.query)}&count=${count}`;

    let response;
    try {
      response = await fetch(url, {
        headers: {
          'Accept':               'application/json',
          'Accept-Encoding':      'gzip',
          'X-Subscription-Token': apiKey,
        },
      });
    } catch (err) {
      return { error: `Search request failed: ${err.message}` };
    }

    if (!response.ok) {
      return { error: `Search API returned ${response.status}` };
    }

    const data    = await response.json();
    const results = (data?.web?.results ?? []).map(r => ({
      title:       r.title       ?? '',
      url:         r.url         ?? '',
      description: r.description ?? '',
    }));

    return { query: input.query, results };
  },
};

/**
 * query_knowledge_base
 * Semantic search across the organisation's document embeddings.
 * Results are strictly scoped to context.orgId — cross-org leakage is structurally
 * impossible because globalSearch's first SQL predicate is always `org_id = $1`.
 * Project-level access is also enforced inside globalSearch before the query runs.
 * Available to all authenticated users — no role required.
 */
const queryKnowledgeBaseTool = {
  name: 'query_knowledge_base',
  description:
    'Search the organisation\'s knowledge base using semantic similarity. ' +
    'Returns relevant document chunks scoped to the caller\'s permitted content. ' +
    'Use this to find information from uploaded files and project documents.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query in natural language.',
      },
      topK: {
        type: 'number',
        description: 'Number of results to return (1–20). Defaults to 5.',
      },
    },
    required: ['query'],
  },
  requiredPermissions: [],
  toolSlug: null,

  async execute(input, context) {
    // orgId is sourced exclusively from context — never from input.
    // This is the hard isolation guarantee: an agent cannot search another org's
    // documents by passing a different orgId in the tool input.
    const isAdmin    = await PermissionService.isOrgAdmin(context.userId);
    const userRole   = isAdmin ? 'org_admin' : 'member';
    const limit      = Math.min(Math.max(1, input.topK ?? 5), 20);

    const queryEmbedding = await embedQuery(input.query);
    const results        = await globalSearch(
      context.orgId,
      context.userId,
      userRole,
      queryEmbedding,
      { limit }
    );

    return {
      query: input.query,
      results: results.map(r => ({
        content:    r.content_preview,  // first 200 chars of the chunk
        scope:      r.tool_scope,
        resourceId: r.resource_id,
        score:      r.similarity_score,
      })),
    };
  },
};

/**
 * send_email
 * Send an email via the platform's EmailService (MailChannels → SMTP fallback).
 * Gated by the 'can_send_email' role — not available to all org members by default.
 * Admins grant this role to users or agent tool configurations that need it.
 */
const sendEmailTool = {
  name: 'send_email',
  description:
    'Send an email to a specified recipient. ' +
    'Requires the can_send_email permission.',
  input_schema: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Recipient email address.',
      },
      subject: {
        type: 'string',
        description: 'Email subject line.',
      },
      body: {
        type: 'string',
        description: 'Email body. Accepts plain text or HTML.',
      },
    },
    required: ['to', 'subject', 'body'],
  },
  requiredPermissions: ['can_send_email'],
  toolSlug: null,

  async execute(input, _context) {
    await sendEmail({
      to:      input.to,
      subject: input.subject,
      html:    input.body,  // accepts HTML
      text:    input.body,  // plain-text fallback for non-HTML clients
    });
    return { sent: true, to: input.to, subject: input.subject };
  },
};

// ─── Singleton ────────────────────────────────────────────────────────────────

// Module-level singleton — Node's require cache ensures a single registry instance
// is shared across all importers. Domain modules (e.g. ads) call
// toolRegistry.register() at their own module load to add their tools.
const toolRegistry = new ToolRegistry();
toolRegistry.register(webSearchTool);
toolRegistry.register(queryKnowledgeBaseTool);
toolRegistry.register(sendEmailTool);

module.exports = { ToolRegistry, ValidationError, toolRegistry };
