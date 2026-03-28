/**
 * Google auth diagnostic — run locally to confirm credentials are working.
 *
 * Usage:
 *   node scripts/test-google-auth.js
 *
 * Reads from .env (same as the server). Checks each credential in sequence
 * and stops at the first failure with a clear error message.
 */

import { google } from 'googleapis';
import 'dotenv/config';

const REQUIRED = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_MANAGER_ID',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_GA4_PROPERTY_ID',
];

console.log('── Env var check ──────────────────────────────────');
let missing = false;
for (const key of REQUIRED) {
  const val = process.env[key];
  if (!val) {
    console.log(`❌  ${key} — NOT SET`);
    missing = true;
  } else {
    // Show first 6 chars only so tokens aren't exposed in logs
    console.log(`✅  ${key} — ${val.slice(0, 6)}…`);
  }
}

if (missing) {
  console.log('\nFix missing env vars in .env then re-run.');
  process.exit(1);
}

console.log('\n── OAuth2 token refresh ───────────────────────────');
const oauth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);
oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

let accessToken;
try {
  const { token } = await oauth2.getAccessToken();
  accessToken = token;
  console.log(`✅  Access token obtained — ${accessToken.slice(0, 12)}…`);
} catch (err) {
  console.log(`❌  Token refresh failed: ${err.message}`);
  console.log('\nMost likely causes:');
  console.log('  • GOOGLE_REFRESH_TOKEN is the old (revoked) token — update it with the new one from the auth script');
  console.log('  • GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET do not match the OAuth2 client that issued the token');
  process.exit(1);
}

console.log('\n── Google Ads API ─────────────────────────────────');
const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, '');
const managerId  = process.env.GOOGLE_ADS_MANAGER_ID.replace(/-/g, '');
const devToken   = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

try {
  const res = await fetch(
    `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`,
    {
      method: 'POST',
      headers: {
        'Authorization':     `Bearer ${accessToken}`,
        'developer-token':   devToken,
        'login-customer-id': managerId,
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({ query: 'SELECT customer.id FROM customer LIMIT 1' }),
    }
  );

  if (res.ok) {
    const data = await res.json();
    console.log(`✅  Google Ads API responded — customer id: ${data.results?.[0]?.customer?.id ?? '(no result)'}`);
  } else {
    const body = await res.text();
    console.log(`❌  Google Ads API error ${res.status}: ${body}`);
    console.log('\nCommon causes:');
    console.log('  • GOOGLE_ADS_CUSTOMER_ID wrong or no access');
    console.log('  • GOOGLE_ADS_MANAGER_ID wrong — must be the MCC that granted the developer token');
    console.log('  • GOOGLE_ADS_DEVELOPER_TOKEN not approved or wrong account');
  }
} catch (err) {
  console.log(`❌  Google Ads fetch failed: ${err.message}`);
}

console.log('\n── Google Analytics (GA4) ─────────────────────────');
const propertyId = process.env.GOOGLE_GA4_PROPERTY_ID;

try {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        metrics:    [{ name: 'sessions' }],
        limit:      1,
      }),
    }
  );

  if (res.ok) {
    const data = await res.json();
    console.log(`✅  GA4 API responded — ${data.rowCount ?? 0} rows returned`);
  } else {
    const body = await res.text();
    console.log(`❌  GA4 API error ${res.status}: ${body}`);
    console.log('\nCommon causes:');
    console.log('  • GOOGLE_GA4_PROPERTY_ID wrong');
    console.log('  • analytics.readonly scope not included in the OAuth2 grant — re-run get-google-refresh-token.js');
  }
} catch (err) {
  console.log(`❌  GA4 fetch failed: ${err.message}`);
}

console.log('\n──────────────────────────────────────────────────');
