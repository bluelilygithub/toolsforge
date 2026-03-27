'use strict';

/**
 * Google Ads Monitor agent route.
 *
 * Wires runAdsMonitor into the platform createAgentRoute factory and registers
 * a twice-daily cron schedule via AgentScheduler.
 *
 * Mounted at: /api/agents/google-ads-monitor
 *   POST /run     — trigger a run (SSE)
 *   GET  /history — last 20 runs for the authenticated org
 */

const { createAgentRoute } = require('../../platform/createAgentRoute');
const { AgentScheduler }   = require('../../platform/AgentScheduler');
const { runAdsMonitor }    = require('../../agents/googleAdsMonitor');

// 6am and 6pm UTC — equivalent to 4pm and 4am AEST (UTC+10).
AgentScheduler.register({
  slug:     'google-ads-monitor',
  schedule: '0 6,18 * * *',
  runFn:    runAdsMonitor,
});

module.exports = createAgentRoute({
  slug:               'google-ads-monitor',
  runFn:              runAdsMonitor,
  requiredPermission: 'google_ads_monitor.run',
});
