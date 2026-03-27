/**
 * CampaignPerformanceTable — renders the get_campaign_performance tool result.
 *
 * Props:
 *   campaigns — array of { id, name, status, budget, impressions, clicks,
 *               cost, conversions, ctr, avgCpc }
 */
export default function CampaignPerformanceTable({ campaigns }) {
  if (!campaigns?.length) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
        No campaign data available.
      </p>
    );
  }

  const fmt = {
    aud:  v => `$${Number(v).toFixed(2)}`,
    pct:  v => `${(Number(v) * 100).toFixed(2)}%`,
    int:  v => Number(v).toLocaleString(),
    dec:  v => Number(v).toFixed(2),
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
            {['Campaign', 'Status', 'Impressions', 'Clicks', 'CTR', 'Cost (AUD)', 'Conversions', 'CPA'].map(h => (
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
          {campaigns.map((c, i) => {
            const cpa = c.conversions > 0 ? c.cost / c.conversions : null;
            return (
              <tr
                key={c.id ?? i}
                style={{ borderBottom: '1px solid var(--color-border)' }}
              >
                <td className="py-2 px-3 font-medium" style={{ color: 'var(--color-text)' }}>
                  {c.name}
                </td>
                <td className="py-2 px-3">
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background: c.status === 'ENABLED' ? 'rgba(34,197,94,0.15)' : 'rgba(156,163,175,0.2)',
                      color:      c.status === 'ENABLED' ? '#16a34a' : 'var(--color-muted)',
                    }}
                  >
                    {c.status}
                  </span>
                </td>
                <td className="py-2 px-3 text-right" style={{ color: 'var(--color-text)' }}>{fmt.int(c.impressions)}</td>
                <td className="py-2 px-3 text-right" style={{ color: 'var(--color-text)' }}>{fmt.int(c.clicks)}</td>
                <td className="py-2 px-3 text-right" style={{ color: 'var(--color-text)' }}>{fmt.pct(c.ctr)}</td>
                <td className="py-2 px-3 text-right" style={{ color: 'var(--color-text)' }}>{fmt.aud(c.cost)}</td>
                <td className="py-2 px-3 text-right" style={{ color: 'var(--color-text)' }}>{fmt.dec(c.conversions)}</td>
                <td className="py-2 px-3 text-right" style={{ color: 'var(--color-text)' }}>
                  {cpa != null ? fmt.aud(cpa) : <span style={{ color: 'var(--color-muted)' }}>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
