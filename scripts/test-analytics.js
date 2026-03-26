'use strict';

/**
 * Smoke test for GoogleAnalyticsService.
 *
 * Verifies the entire auth chain end-to-end:
 *   OAuth2 refresh token → access token → GA4 Data API → real session data
 *
 * Run from the project root:
 *   node scripts/test-analytics.js
 *
 * Expected: array of daily session objects from the configured GA4 property.
 * A successful response confirms OAuth2, analytics.readonly scope, and the
 * GA4 property ID are all working correctly.
 */

// Load .env from project root before any service module is imported
require('dotenv').config();

const { googleAnalyticsService } = require('../server/services/GoogleAnalyticsService');

async function main() {
  console.log('Testing Google Analytics Data API connection...');
  console.log(`GA4 Property ID : ${process.env.GOOGLE_GA4_PROPERTY_ID}\n`);

  try {
    const overview = await googleAnalyticsService.getSessionsOverview(7);

    console.log('Sessions Overview — last 7 days:');
    console.log(JSON.stringify(overview, null, 2));
    console.log(`\n✅ Success — ${overview.length} day(s) returned`);
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
}

main();
