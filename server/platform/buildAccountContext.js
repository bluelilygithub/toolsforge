'use strict';

/**
 * buildAccountContext — platform-level utility.
 *
 * Formats an account intelligence profile JSONB object into a string
 * suitable for injection as the first block of an agent system prompt.
 *
 * This function is generic. It contains no agent-specific logic.
 * The agentSlug parameter is reserved for future per-agent formatting
 * differences and is not used in the current implementation.
 *
 * Profile shape:
 *   Shared base (all agents):
 *     targetROAS:            number  — target return on ad spend (e.g. 7 = 7x)
 *     targetCPA:             number  — target cost per acquisition in AUD
 *     businessContext:       string  — free text describing the business model
 *                                      and what success looks like
 *     analyticalGuardrails:  string[] — instructions constraining how the
 *                                      agent reasons
 *
 *   agentSpecific extension field (open JSONB, agent-owned keys):
 *     Google Ads agent uses:
 *       conversionRateBaseline:     number — account-level CVR % baseline
 *       averageOrderValue:          number — AOV in AUD
 *       typicalConversionLagDays:   number — days between click and conversion
 *
 * @param {object|null} profile   - The intelligence_profile from agent_configs
 * @param {string}      agentSlug - Agent identifier (reserved, not used yet)
 * @returns {string} Formatted context block, or '' if profile is null/empty
 */
function buildAccountContext(profile, agentSlug) { // eslint-disable-line no-unused-vars
  if (!profile || typeof profile !== 'object' || Object.keys(profile).length === 0) {
    return '';
  }

  const lines = ['## Account Intelligence Profile', ''];

  // ── Shared base fields ────────────────────────────────────────────────────

  if (profile.targetROAS != null) {
    lines.push(`**Target ROAS:** ${profile.targetROAS}x`);
  }

  if (profile.targetCPA != null) {
    lines.push(`**Target CPA:** $${profile.targetCPA} AUD`);
  }

  if (profile.businessContext && profile.businessContext.trim()) {
    lines.push('');
    lines.push('**Business Context:**');
    lines.push(profile.businessContext.trim());
  }

  if (Array.isArray(profile.analyticalGuardrails) && profile.analyticalGuardrails.length > 0) {
    const guardrails = profile.analyticalGuardrails.filter(g => g && g.trim());
    if (guardrails.length > 0) {
      lines.push('');
      lines.push('**Analytical Guardrails — these constraints apply to every recommendation:**');
      for (const g of guardrails) {
        lines.push(`- ${g.trim()}`);
      }
    }
  }

  // ── Agent-specific extension field ────────────────────────────────────────

  const ext = profile.agentSpecific;
  if (ext && typeof ext === 'object' && Object.keys(ext).length > 0) {
    const baselineLines = [];

    if (ext.conversionRateBaseline != null) {
      baselineLines.push(`- Conversion Rate Baseline: ${ext.conversionRateBaseline}%`);
    }
    if (ext.averageOrderValue != null) {
      baselineLines.push(`- Average Order Value: $${ext.averageOrderValue} AUD`);
    }
    if (ext.typicalConversionLagDays != null) {
      baselineLines.push(`- Typical Conversion Lag: ${ext.typicalConversionLagDays} days`);
    }

    if (baselineLines.length > 0) {
      lines.push('');
      lines.push('**Account Baselines:**');
      lines.push(...baselineLines);
    }
  }

  lines.push('');

  return lines.join('\n');
}

module.exports = { buildAccountContext };
