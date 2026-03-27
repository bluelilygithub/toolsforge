/**
 * SearchTermsTable — renders the get_search_terms tool result.
 *
 * Props:
 *   terms — array of { term, status, impressions, clicks, cost, conversions, ctr }
 *
 * Intent bucket is derived from each term's own metrics:
 *   Converting       — conversions > 0
 *   Wasted Spend     — clicks >= 5 and conversions === 0
 *   Ad Copy Oppty    — impressions >= 100 and ctr < 0.05
 *   Standard         — everything else
 */

const BUCKET_STYLES = {
  'Converting':    { bg: 'rgba(34,197,94,0.12)',   color: '#16a34a' },
  'Wasted Spend':  { bg: 'rgba(239,68,68,0.12)',   color: '#dc2626' },
  'Ad Copy Oppty': { bg: 'rgba(234,179,8,0.15)',   color: '#ca8a04' },
  'Standard':      { bg: 'rgba(156,163,175,0.15)', color: '#6b7280' },
};

function intentBucket(term) {
  if (term.conversions > 0) return 'Converting';
  if (term.clicks >= 5 && term.conversions === 0) return 'Wasted Spend';
  if (term.impressions >= 100 && term.ctr < 0.05) return 'Ad Copy Oppty';
  return 'Standard';
}

export default function SearchTermsTable({ terms }) {
  if (!terms?.length) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
        No search term data available.
      </p>
    );
  }

  const fmt = {
    aud: v => `$${Number(v).toFixed(2)}`,
    pct: v => `${(Number(v) * 100).toFixed(2)}%`,
    int: v => Number(v).toLocaleString(),
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
            {['Search Term', 'Clicks', 'Impressions', 'CTR', 'Cost (AUD)', 'Intent'].map(h => (
              <th
                key={h}
                className="text-left py-2 px-3 font-semibold"
                style={{ color: 'var(--color-muted)', whiteSpace: 'nowrap' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {terms.map((t, i) => {
            const bucket = intentBucket(t);
            const style  = BUCKET_STYLES[bucket];
            return (
              <tr
                key={i}
                style={{ borderBottom: '1px solid var(--color-border)' }}
              >
                <td className="py-2 px-3 font-medium" style={{ color: 'var(--color-text)', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.term}
                </td>
                <td className="py-2 px-3 text-right" style={{ color: 'var(--color-text)' }}>{fmt.int(t.clicks)}</td>
                <td className="py-2 px-3 text-right" style={{ color: 'var(--color-text)' }}>{fmt.int(t.impressions)}</td>
                <td className="py-2 px-3 text-right" style={{ color: 'var(--color-text)' }}>{fmt.pct(t.ctr)}</td>
                <td className="py-2 px-3 text-right" style={{ color: 'var(--color-text)' }}>{fmt.aud(t.cost)}</td>
                <td className="py-2 px-3">
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: style.bg, color: style.color }}
                  >
                    {bucket}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
