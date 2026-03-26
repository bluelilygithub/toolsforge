'use strict';

/**
 * Smoke test for the Google Ads Monitor agent.
 *
 * Runs the full agent stack end-to-end:
 *   OAuth2 tokens → Google Ads API → GA4 Data API → Claude ReAct loop → analysis
 *
 * Run from the project root:
 *   node scripts/test-agent.js
 *
 * Expected output: Claude's structured analysis including Summary, Campaign
 * Analysis, Search Term Insights, and Recommendations sections, followed by
 * token usage and iteration count.
 *
 * Note: conclusion persistence is skipped when orgId is not a valid DB integer
 * (the test context uses a string). The warning is expected — the analysis runs
 * and returns regardless.
 */

// Load .env from project root before any service module is imported
require('dotenv').config();

const { runAdsMonitor } = require('../server/agents/googleAdsMonitor');

const TEST_CONTEXT = {
  userId:   'test',
  orgId:    'test',
  toolSlug: 'google-ads-monitor',
};

async function main() {
  console.log('Running Google Ads Monitor agent...');
  console.log('Context:', TEST_CONTEXT);
  console.log('─'.repeat(60));

  const startMs = Date.now();

  try {
    const { result, trace, tokensUsed } = await runAdsMonitor(TEST_CONTEXT);

    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);

    console.log('\n' + '═'.repeat(60));
    console.log('AGENT ANALYSIS');
    console.log('═'.repeat(60) + '\n');
    console.log(result);
    console.log('\n' + '─'.repeat(60));
    console.log('Iterations  :', trace.length);
    console.log('Elapsed     :', `${elapsedSec}s`);
    console.log('Tokens used :', JSON.stringify(tokensUsed));

    // Print tool call summary from the trace
    const toolCallSummary = trace.flatMap(step =>
      step.toolCalls.map(tc => `  [iter ${step.iteration}] ${tc.name}(days=${tc.input?.days ?? 30})`)
    );
    if (toolCallSummary.length > 0) {
      console.log('\nTool calls:');
      toolCallSummary.forEach(s => console.log(s));
    }

    console.log('\n✅ Agent run complete');
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.trace?.length > 0) {
      console.error('Partial trace iterations:', err.trace.length);
    }
    process.exit(1);
  }
}

main();
