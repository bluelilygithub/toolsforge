/**
 * PerformanceChart — daily spend and conversions over the run date range.
 *
 * Props:
 *   daily — array of { date, impressions, clicks, cost, conversions }
 *           from the get_daily_performance tool result
 */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';

function shortDate(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function AudTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg shadow-md px-3 py-2 text-sm"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text)',
      }}
    >
      <p className="font-semibold mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.dataKey === 'cost' ? `$${Number(p.value).toFixed(2)}` : Number(p.value).toFixed(2)}
        </p>
      ))}
    </div>
  );
}

export default function PerformanceChart({ daily }) {
  if (!daily?.length) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
        No daily performance data available.
      </p>
    );
  }

  const chartData = daily.map(d => ({
    date:        shortDate(d.date),
    cost:        Number(d.cost),
    conversions: Number(d.conversions),
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-border)' }}
          interval="preserveStartEnd"
        />
        <YAxis
          yAxisId="cost"
          orientation="left"
          tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={v => `$${v}`}
        />
        <YAxis
          yAxisId="conv"
          orientation="right"
          tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<AudTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12, color: 'var(--color-muted)' }} />
        <Line
          yAxisId="cost"
          type="monotone"
          dataKey="cost"
          name="Spend (AUD)"
          stroke="var(--color-primary)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          yAxisId="conv"
          type="monotone"
          dataKey="conversions"
          name="Conversions"
          stroke="#22c55e"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
