'use strict';

/**
 * GoogleAnalyticsService — Google Analytics Data API (GA4) data layer.
 *
 * Makes authenticated REST calls to the Google Analytics Data API v1beta.
 * Auth: OAuth2 via googleapis (same pattern as GoogleAdsService — access token
 * refresh handled automatically by the OAuth2 client).
 * HTTP: Node built-in fetch (no additional package needed).
 *
 * Required environment variables:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN  — OAuth2 credentials
 *   GOOGLE_GA4_PROPERTY_ID                                         — GA4 property (numeric, e.g. "123456789")
 *
 * Usage:
 *   const { googleAnalyticsService } = require('../services/GoogleAnalyticsService');
 *   const overview = await googleAnalyticsService.getSessionsOverview(30);
 */

const { google } = require('googleapis');

const API_BASE = 'https://analyticsdata.googleapis.com/v1beta';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a Date as YYYY-MM-DD for GA4 API date strings. */
function fmtDate(d) {
  return d.toISOString().split('T')[0];
}

/**
 * Compute a GA4-ready date range ending today.
 * @param {number} days - How many days back to start from.
 * @returns {{ startDate: string, endDate: string }}
 */
function dateRange(days) {
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { startDate: fmtDate(start), endDate: fmtDate(end) };
}

/**
 * Convert GA4 date string YYYYMMDD → YYYY-MM-DD.
 * GA4 returns dates without separators; normalise for consistency with the rest
 * of the platform.
 */
function normDate(raw) {
  if (!raw || raw.length !== 8) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

// ─── GoogleAnalyticsService ───────────────────────────────────────────────────

class GoogleAnalyticsService {
  constructor() {
    // OAuth2 client — credentials sourced exclusively from environment.
    // Identical pattern to GoogleAdsService — same OAuth2 grant covers both
    // Google Ads (adwords scope) and Analytics (analytics.readonly scope).
    this._oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    this._oauth2.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });

    // GA4 property ID — numeric string, no "properties/" prefix.
    this._propertyId = process.env.GOOGLE_GA4_PROPERTY_ID ?? '';
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Return a fresh access token, rotating via the refresh token automatically.
   */
  async _getAccessToken() {
    const { token } = await this._oauth2.getAccessToken();
    return token;
  }

  /**
   * POST a runReport request to the GA4 Data API.
   * Returns the full API response object (dimensionHeaders, metricHeaders, rows).
   *
   * @param {object} body - GA4 RunReportRequest body
   * @returns {Promise<object>}
   */
  async _runReport(body) {
    const accessToken = await this._getAccessToken();

    const response = await fetch(
      `${API_BASE}/properties/${this._propertyId}:runReport`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Analytics API ${response.status}: ${text}`);
    }

    return response.json();
  }

  /**
   * Convert the parallel dimensionHeaders/metricHeaders/rows structure returned
   * by GA4 into a flat array of plain objects.
   *
   * GA4 response shape:
   *   { dimensionHeaders: [{name}], metricHeaders: [{name}], rows: [{dimensionValues, metricValues}] }
   * Each value is always a string — callers cast to number as needed.
   *
   * @param {object} data - Raw GA4 API response
   * @returns {Array<object>}
   */
  _parseRows(data) {
    const dimKeys = (data.dimensionHeaders ?? []).map(h => h.name);
    const metKeys = (data.metricHeaders   ?? []).map(h => h.name);

    return (data.rows ?? []).map(row => {
      const obj = {};
      (row.dimensionValues ?? []).forEach((dv, i) => { obj[dimKeys[i]] = dv.value; });
      (row.metricValues    ?? []).forEach((mv, i) => { obj[metKeys[i]] = mv.value; });
      return obj;
    });
  }

  // ── Public methods ────────────────────────────────────────────────────────

  /**
   * Daily session metrics — one row per day, suitable for time-series charting.
   *
   * @param {number} [days=30]
   * @returns {Promise<Array<{ date, sessions, activeUsers, newUsers, bounceRate }>>}
   */
  async getSessionsOverview(days = 30) {
    const { startDate, endDate } = dateRange(days);

    const data = await this._runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'newUsers' },
        { name: 'bounceRate' },
      ],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
    });

    return this._parseRows(data).map(r => ({
      date:        normDate(r.date        ?? ''),
      sessions:    parseInt(r.sessions    ?? '0'),
      activeUsers: parseInt(r.activeUsers ?? '0'),
      newUsers:    parseInt(r.newUsers    ?? '0'),
      // bounceRate is a decimal fraction (e.g. 0.42 = 42%) — keep as-is for charting
      bounceRate:  parseFloat(r.bounceRate ?? '0'),
    }));
  }

  /**
   * Traffic source breakdown — one row per channel group.
   * Shows paid vs organic vs direct vs referral split.
   *
   * @param {number} [days=30]
   * @returns {Promise<Array<{ channel, sessions, conversions, totalRevenue }>>}
   */
  async getTrafficSources(days = 30) {
    const { startDate, endDate } = dateRange(days);

    const data = await this._runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [
        { name: 'sessions' },
        { name: 'conversions' },
        { name: 'totalRevenue' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    });

    return this._parseRows(data).map(r => ({
      channel:      r.sessionDefaultChannelGroup ?? '',
      sessions:     parseInt(r.sessions           ?? '0'),
      conversions:  parseFloat(r.conversions      ?? '0'),
      totalRevenue: parseFloat(r.totalRevenue      ?? '0'),
    }));
  }

  /**
   * Top landing pages by session volume.
   * Useful for identifying which entry points drive the most traffic.
   *
   * @param {number} [days=30]
   * @returns {Promise<Array<{ page, sessions, conversions, bounceRate, avgSessionDuration }>>}
   */
  async getLandingPagePerformance(days = 30) {
    const { startDate, endDate } = dateRange(days);

    const data = await this._runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'landingPage' }],
      metrics: [
        { name: 'sessions' },
        { name: 'conversions' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 20,
    });

    return this._parseRows(data).map(r => ({
      page:               r.landingPage             ?? '',
      sessions:           parseInt(r.sessions       ?? '0'),
      conversions:        parseFloat(r.conversions  ?? '0'),
      bounceRate:         parseFloat(r.bounceRate   ?? '0'),
      // averageSessionDuration is in seconds
      avgSessionDuration: parseFloat(r.averageSessionDuration ?? '0'),
    }));
  }

  /**
   * Conversion events — only events that resulted in at least one conversion.
   * Broken down by event name and date for trend analysis.
   *
   * @param {number} [days=30]
   * @returns {Promise<Array<{ event, date, eventCount, conversions }>>}
   */
  async getConversionEvents(days = 30) {
    const { startDate, endDate } = dateRange(days);

    const data = await this._runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [
        { name: 'eventName' },
        { name: 'date' },
      ],
      metrics: [
        { name: 'eventCount' },
        { name: 'conversions' },
      ],
      // Filter to rows where conversions > 0 — eliminates noise from non-conversion events
      metricFilter: {
        filter: {
          fieldName: 'conversions',
          numericFilter: {
            operation: 'GREATER_THAN',
            value: { doubleValue: 0 },
          },
        },
      },
      orderBys: [
        { dimension: { dimensionName: 'date' }, desc: false },
        { metric: { metricName: 'conversions' }, desc: true },
      ],
    });

    return this._parseRows(data).map(r => ({
      event:       r.eventName           ?? '',
      date:        normDate(r.date       ?? ''),
      eventCount:  parseInt(r.eventCount ?? '0'),
      conversions: parseFloat(r.conversions ?? '0'),
    }));
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const googleAnalyticsService = new GoogleAnalyticsService();

module.exports = { GoogleAnalyticsService, googleAnalyticsService };
