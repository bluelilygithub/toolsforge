const DEFAULTS = require('../utils/emailDefaults');
const logger = require('../utils/logger');

// Render a template by replacing {{variable}} placeholders with values.
function render(template, vars = {}) {
  let subject  = template.subject;
  let bodyHtml = template.body_html;
  let bodyText = template.body_text;

  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    const safe = value != null ? String(value) : '';
    subject  = subject.replace(re, safe);
    bodyHtml = bodyHtml.replace(re, safe);
    bodyText = bodyText.replace(re, safe);
  }

  return { subject, html: bodyHtml, text: bodyText };
}

const EmailTemplateService = {
  /**
   * Fetch a template by slug. Falls back to hardcoded default if not in DB.
   */
  async get(slug) {
    const { pool } = require('../db');
    const result = await pool.query(
      `SELECT slug, tool_slug, subject, body_html, body_text, variables, description, updated_at
       FROM email_templates WHERE slug = $1`,
      [slug]
    );
    if (result.rows.length > 0) {
      const row = result.rows[0];
      logger.info('Email template loaded from DB', {
        slug,
        subject:       row.subject,
        body_html_len: row.body_html?.length,
        body_text_len: row.body_text?.length,
        updated_at:    row.updated_at,
      });
      return row;
    }
    logger.warn('Email template not in DB — using hardcoded default', { slug });
    return DEFAULTS[slug] || null;
  },

  /**
   * Fetch a template and render it with the provided variables.
   */
  async render(slug, vars = {}) {
    const template = await this.get(slug);
    if (!template) throw new Error(`Email template '${slug}' not found`);
    const result = render(template, vars);
    logger.info('Email template rendered', {
      slug,
      subject:          result.subject,
      body_html_prefix: result.html?.slice(0, 80),
      body_text_prefix: result.text?.slice(0, 80),
    });
    return result;
  },

  /**
   * List all templates.
   */
  async list() {
    const { pool } = require('../db');
    const result = await pool.query(
      `SELECT slug, tool_slug, subject, description, variables, updated_at
       FROM email_templates
       ORDER BY tool_slug NULLS FIRST, slug`
    );
    return result.rows;
  },

  /**
   * Create or update a template.
   */
  async upsert(slug, { subject, body_html, body_text }, updatedBy) {
    const { pool } = require('../db');
    await pool.query(
      `INSERT INTO email_templates (slug, subject, body_html, body_text, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (slug) DO UPDATE
       SET subject    = EXCLUDED.subject,
           body_html  = EXCLUDED.body_html,
           body_text  = EXCLUDED.body_text,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
      [slug, subject, body_html, body_text, updatedBy]
    );
  },

  /**
   * Reset a template to its default content.
   */
  async reset(slug, updatedBy) {
    const def = DEFAULTS[slug];
    if (!def) throw new Error(`No default exists for template '${slug}'`);
    await this.upsert(slug, {
      subject:   def.subject,
      body_html: def.body_html,
      body_text: def.body_text,
    }, updatedBy);
  },

};

module.exports = EmailTemplateService;
