'use strict';

/**
 * Google Ads Monitor — tool registrations.
 *
 * Registers four tools into the platform ToolRegistry under toolSlug
 * 'google-ads-monitor'. The toolSlug is a security boundary: these tools
 * will never appear in another agent's tool list even if the same user
 * triggers a different agent.
 *
 * This module is imported by index.js. The require() call is the trigger
 * that runs the side-effect registrations — no explicit init step needed.
 *
 * Tools exported as an array so index.js can reference them directly
 * without a second call to toolRegistry.getAvailableTools().
 */

const { toolRegistry } = require('../../services/ToolRegistry');
const { googleAdsService }       = require('../../services/GoogleAdsService');
const { googleAnalyticsService } = require('../../services/GoogleAnalyticsService');

const TOOL_SLUG = 'google-ads-monitor';

// ── Shared input schema for every tool in this agent ─────────────────────────
// All four methods accept a single optional `days` parameter.

const daysSchema = {
  type: 'object',
  properties: {
    days: {
      type:        'integer',
      description: 'Number of days to look back from today. Defaults to 30.',
      default:     30,
    },
  },
  required: [],
};

// ── Tool definitions ──────────────────────────────────────────────────────────

const getCampaignPerformanceTool = {
  name: 'get_campaign_performance',
  description:
    'Retrieve performance totals for every enabled Google Ads campaign over the ' +
    'specified date range. Returns one object per campaign with: id, name, status, ' +
    'monthly budget (AUD), impressions, clicks, cost (AUD), conversions, CTR, and ' +
    'average CPC. Use this first to understand which campaigns are running and their ' +
    'overall efficiency.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,

  async execute(input, _context) {
    return googleAdsService.getCampaignPerformance(input.days ?? 30);
  },
};

const getDailyPerformanceTool = {
  name: 'get_daily_performance',
  description:
    'Retrieve account-level daily aggregated metrics: date, impressions, clicks, ' +
    'cost (AUD), and conversions — one row per day ordered by date ASC. ' +
    'Use this to identify trends, spend acceleration, and day-of-week patterns ' +
    'that are invisible in campaign-level totals.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,

  async execute(input, _context) {
    return googleAdsService.getDailyPerformance(input.days ?? 30);
  },
};

const getSearchTermsTool = {
  name: 'get_search_terms',
  description:
    'Retrieve the top 50 actual user search queries that triggered ads, ordered by ' +
    'clicks DESC. Returns: term, status, impressions, clicks, cost (AUD), conversions, ' +
    'and CTR per term. This is the highest-signal dataset for intent analysis — ' +
    'use it to find converting vs wasted-spend terms, negative keyword candidates, ' +
    'and ad copy opportunities.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,

  async execute(input, _context) {
    return googleAdsService.getSearchTerms(input.days ?? 30);
  },
};

const getAnalyticsOverviewTool = {
  name: 'get_analytics_overview',
  description:
    'Retrieve daily GA4 session metrics: date, sessions, activeUsers, newUsers, ' +
    'and bounceRate (decimal fraction, e.g. 0.42 = 42%) — ordered by date ASC. ' +
    'Use this to correlate ad spend trends from get_daily_performance with on-site ' +
    'behaviour, and to identify whether paid traffic quality is improving or declining.',
  input_schema:        daysSchema,
  requiredPermissions: [],
  toolSlug:            TOOL_SLUG,

  async execute(input, _context) {
    return googleAnalyticsService.getSessionsOverview(input.days ?? 30);
  },
};

// ── Register into platform ToolRegistry ──────────────────────────────────────
// Side-effect at module load — happens once when index.js first requires this file.

toolRegistry.register(getCampaignPerformanceTool);
toolRegistry.register(getDailyPerformanceTool);
toolRegistry.register(getSearchTermsTool);
toolRegistry.register(getAnalyticsOverviewTool);

// ── Export array for direct use in index.js ───────────────────────────────────

const googleAdsMonitorTools = [
  getCampaignPerformanceTool,
  getDailyPerformanceTool,
  getSearchTermsTool,
  getAnalyticsOverviewTool,
];

module.exports = { googleAdsMonitorTools, TOOL_SLUG };
