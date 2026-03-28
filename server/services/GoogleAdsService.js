'use strict';

/**
 * GoogleAdsService — Google Ads API data layer.
 *
 * Makes authenticated REST calls to the Google Ads API v19.
 * Auth: OAuth2 via googleapis (access token refresh handled automatically).
 * HTTP: Node built-in fetch (no additional package needed).
 *
 * All monetary values from the API are in micros (1/1,000,000 of the currency).
 * Every cost field is divided by 1,000,000 before being returned.
 *
 * Usage:
 *   const { googleAdsService } = require('../services/GoogleAdsService');
 *   const campaigns = await googleAdsService.getCampaignPerformance(30);
 */

const { google } = require('googleapis');

const API_VERSION = 'v23';
const ADS_BASE    = `https://googleads.googleapis.com/${API_VERSION}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a Date as YYYY-MM-DD for GAQL date literals. */
function fmtDate(d) {
  return d.toISOString().split('T')[0];
}

/**
 * Compute a GAQL-ready date range ending today.
 * @param {number} days - How many days back to start from.
 * @returns {{ from: string, to: string }}
 */
function dateRange(days) {
  const to   = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: fmtDate(from), to: fmtDate(to) };
}

// ─── GoogleAdsService ─────────────────────────────────────────────────────────

class GoogleAdsService {
  constructor() {
    // OAuth2 client — credentials sourced exclusively from environment.
    // Never hardcode client IDs, secrets, or tokens.
    this._oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    this._oauth2.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });

    // Customer ID: the advertiser account being queried (dashes stripped).
    // Manager ID: the MCC account used for authentication (login-customer-id header).
    // Both are required when authenticating through a Manager Account.
    this._customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/-/g, '');
    this._managerId  = (process.env.GOOGLE_ADS_MANAGER_ID  ?? '').replace(/-/g, '');
    this._devToken   = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '';
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Return a fresh access token, rotating via the refresh token automatically.
   * The googleapis OAuth2 client caches the access token and re-fetches when
   * it expires — no manual token management needed.
   */
  async _getAccessToken() {
    const { token } = await this._oauth2.getAccessToken();
    return token;
  }

  /**
   * Execute a GAQL query against the Google Ads API search endpoint.
   * Returns the raw `results` array from the API response.
   *
   * @param {string} gaql - Google Ads Query Language string
   * @returns {Promise<Array>}
   */
  async _search(gaql) {
    const accessToken = await this._getAccessToken();

    const response = await fetch(
      `${ADS_BASE}/customers/${this._customerId}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          'Authorization':     `Bearer ${accessToken}`,
          'developer-token':   this._devToken,
          // login-customer-id is required when the OAuth2 grant was made through
          // a Manager Account. Omitting it causes a CUSTOMER_NOT_FOUND error.
          'login-customer-id': this._managerId,
          'Content-Type':      'application/json',
        },
        body: JSON.stringify({ query: gaql }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Google Ads API ${response.status}: ${body}`);
    }

    const data = await response.json();
    return data.results ?? [];
  }

  // ── Public methods ────────────────────────────────────────────────────────

  /**
   * Campaign-level performance totals for enabled campaigns.
   * Aggregates all metrics over the requested date range (no daily breakdown).
   *
   * @param {number} [days=30]
   * @returns {Promise<Array<{
   *   id, name, status, budget, impressions, clicks, cost,
   *   conversions, ctr, avgCpc
   * }>>}
   */
  async getCampaignPerformance(days = 30) {
    const { from, to } = dateRange(days);

    const results = await this._search(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign_budget.amount_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM campaign
      WHERE campaign.status = 'ENABLED'
        AND segments.date BETWEEN '${from}' AND '${to}'
    `);

    // REST response field names are camelCase translations of the GAQL snake_case names.
    // All cost_micros fields are divided by 1,000,000 to convert to AUD.
    return results.map(r => ({
      id:          r.campaign?.id          ?? null,
      name:        r.campaign?.name        ?? '',
      status:      r.campaign?.status      ?? '',
      budget:      parseInt(r.campaignBudget?.amountMicros ?? '0') / 1_000_000,
      impressions: parseInt(r.metrics?.impressions          ?? '0'),
      clicks:      parseInt(r.metrics?.clicks               ?? '0'),
      cost:        parseInt(r.metrics?.costMicros           ?? '0') / 1_000_000,
      conversions: parseFloat(r.metrics?.conversions        ?? '0'),
      ctr:         parseFloat(r.metrics?.ctr                ?? '0'),
      avgCpc:      parseInt(r.metrics?.averageCpc           ?? '0') / 1_000_000,
    }));
  }

  /**
   * Daily aggregated metrics across all enabled campaigns.
   * Queries the customer resource for account-level daily totals — one row per day.
   * Suitable for time-series charting.
   *
   * @param {number} [days=30]
   * @returns {Promise<Array<{ date, impressions, clicks, cost, conversions }>>}
   */
  async getDailyPerformance(days = 30) {
    const { from, to } = dateRange(days);

    const results = await this._search(`
      SELECT
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM customer
      WHERE segments.date BETWEEN '${from}' AND '${to}'
      ORDER BY segments.date ASC
    `);

    return results.map(r => ({
      date:        r.segments?.date                                    ?? '',
      impressions: parseInt(r.metrics?.impressions                     ?? '0'),
      clicks:      parseInt(r.metrics?.clicks                          ?? '0'),
      cost:        parseInt(r.metrics?.costMicros                      ?? '0') / 1_000_000,
      conversions: parseFloat(r.metrics?.conversions                   ?? '0'),
    }));
  }

  /**
   * Actual user search terms that triggered ads — the high-intent signal
   * source for AI analysis. Returns top 50 terms by click volume.
   *
   * @param {number} [days=30]
   * @returns {Promise<Array<{ term, status, impressions, clicks, cost, conversions, ctr }>>}
   */
  async getSearchTerms(days = 30) {
    const { from, to } = dateRange(days);

    const results = await this._search(`
      SELECT
        search_term_view.search_term,
        search_term_view.status,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr
      FROM search_term_view
      WHERE segments.date BETWEEN '${from}' AND '${to}'
      ORDER BY metrics.clicks DESC
      LIMIT 50
    `);

    return results.map(r => ({
      term:        r.searchTermView?.searchTerm  ?? '',
      status:      r.searchTermView?.status      ?? '',
      impressions: parseInt(r.metrics?.impressions ?? '0'),
      clicks:      parseInt(r.metrics?.clicks      ?? '0'),
      cost:        parseInt(r.metrics?.costMicros  ?? '0') / 1_000_000,
      conversions: parseFloat(r.metrics?.conversions ?? '0'),
      ctr:         parseFloat(r.metrics?.ctr         ?? '0'),
    }));
  }

  /**
   * Current month spend vs budget per campaign.
   * For Smart Campaigns, campaign_budget.amount_micros is the monthly budget.
   * Filters by THIS_MONTH without date segmentation in SELECT — returns one
   * aggregated row per campaign covering the full month-to-date period.
   *
   * @returns {Promise<Array<{ name, monthlyBudget, spentToDate }>>}
   */
  async getBudgetPacing() {
    const results = await this._search(`
      SELECT
        campaign.name,
        campaign_budget.amount_micros,
        metrics.cost_micros
      FROM campaign
      WHERE campaign.status = 'ENABLED'
        AND segments.date DURING THIS_MONTH
    `);

    return results.map(r => ({
      name:          r.campaign?.name                                            ?? '',
      monthlyBudget: parseInt(r.campaignBudget?.amountMicros ?? '0') / 1_000_000,
      spentToDate:   parseInt(r.metrics?.costMicros          ?? '0') / 1_000_000,
    }));
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const googleAdsService = new GoogleAdsService();

module.exports = { GoogleAdsService, googleAdsService };
