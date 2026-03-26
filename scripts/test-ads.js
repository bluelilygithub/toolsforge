'use strict';

/**
 * Smoke test for GoogleAdsService.
 *
 * Verifies the entire auth chain end-to-end:
 *   OAuth2 refresh token → access token → Google Ads API → real campaign data
 *
 * Run from the project root:
 *   node scripts/test-ads.js
 *
 * Expected: array of campaign objects from account 4128694443.
 * A successful response confirms OAuth2, developer token, Manager Account
 * login-customer-id, and GAQL query are all working correctly.
 */

// Load .env from project root before any service module is imported
require('dotenv').config();

const { googleAdsService } = require('../server/services/GoogleAdsService');

async function main() {
  console.log('Testing Google Ads API connection...');
  console.log(`Customer ID : ${process.env.GOOGLE_ADS_CUSTOMER_ID}`);
  console.log(`Manager ID  : ${process.env.GOOGLE_ADS_MANAGER_ID}\n`);

  try {
    const campaigns = await googleAdsService.getCampaignPerformance(7);

    console.log('Campaign Performance — last 7 days:');
    console.log(JSON.stringify(campaigns, null, 2));
    console.log(`\n✅ Success — ${campaigns.length} campaign(s) returned`);
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
}

main();
