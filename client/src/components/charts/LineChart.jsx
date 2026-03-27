/**
 * LineChart — zero-dependency SVG dual-axis line chart.
 *
 * Platform primitive. Use this when recharts is unavailable or when a
 * lightweight fallback is preferred over a full charting library.
 *
 * Props:
 *   data        — array of objects, one per x-axis point
 *   xKey        — key in each data object to use as the x-axis label (string)
 *   leftKey     — key for the left-axis series (number)
 *   rightKey    — key for the right-axis series (number)
 *   leftLabel   — display name for the left series, shown in the legend
 *   rightLabel  — display name for the right series, shown in the legend
 *   leftFormat  — optional fn(value) => string for left-axis tick labels. Default: String(v)
 *   rightFormat — optional fn(value) => string for right-axis tick labels. Default: String(v)
 *   leftColor   — stroke colour for left series. Default: 'var(--color-primary)'
 *   rightColor  — stroke colour for right series. Default: '#22c55e'
 *   height      — SVG height in px. Default: 220
 */

const DEFAULT_LEFT_COLOR  = 'var(--color-primary)';
const DEFAULT_RIGHT_COLOR = '#22c55e';

const W   = 600;
const PAD = { top: 12, right: 52, bottom: 32, left: 52 };

function buildScale(values, plotH) {
  const max = Math.max(...values, 0.001);
  return v => plotH - (v / max) * plotH;
}

function pointsAttr(xs, ys) {
  return xs.map((x, i) => `${x},${ys[i]}`).join(' ');
}

export default function LineChart({
  data,
  xKey,
  leftKey,
  rightKey,
  leftLabel   = leftKey,
  rightLabel  = rightKey,
  leftFormat  = v => String(v),
  rightFormat = v => String(v),
  leftColor   = DEFAULT_LEFT_COLOR,
  rightColor  = DEFAULT_RIGHT_COLOR,
  height      = 220,
}) {
  if (!data?.length) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
        No data available.
      </p>
    );
  }

  const H      = height;
  const PLOT_W = W - PAD.left - PAD.right;
  const PLOT_H = H - PAD.top - PAD.bottom;

  const lefts  = data.map(d => Number(d[leftKey]));
  const rights = data.map(d => Number(d[rightKey]));

  const scaleLeft  = buildScale(lefts,  PLOT_H);
  const scaleRight = buildScale(rights, PLOT_H);

  const n  = data.length;
  const xs = data.map((_, i) => (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W));
  const ysLeft  = lefts.map(v  => scaleLeft(v));
  const ysRight = rights.map(v => scaleRight(v));

  const tickStep = Math.max(1, Math.floor(n / 6));
  const xTicks   = data
    .map((d, i) => ({ i, label: String(d[xKey]) }))
    .filter((_, i) => i % tickStep === 0 || i === n - 1);

  const maxLeft  = Math.max(...lefts,  0);
  const maxRight = Math.max(...rights, 0);

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', maxWidth: W, display: 'block' }}
      >
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {/* Grid */}
          {[0, 0.25, 0.5, 0.75, 1].map(t => (
            <line
              key={t}
              x1={0} y1={PLOT_H * (1 - t)}
              x2={PLOT_W} y2={PLOT_H * (1 - t)}
              stroke="var(--color-border)"
              strokeDasharray="4 3"
              strokeWidth={1}
            />
          ))}

          {/* Left series */}
          <polyline
            points={pointsAttr(xs, ysLeft)}
            fill="none"
            stroke={leftColor}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Right series */}
          <polyline
            points={pointsAttr(xs, ysRight)}
            fill="none"
            stroke={rightColor}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* X-axis labels */}
          {xTicks.map(({ i, label }) => (
            <text key={i} x={xs[i]} y={PLOT_H + 18} textAnchor="middle" fontSize={10} fill="var(--color-muted)">
              {label}
            </text>
          ))}

          {/* Left Y-axis */}
          {[0, 0.5, 1].map(t => (
            <text key={t} x={-6} y={PLOT_H * (1 - t) + 4} textAnchor="end" fontSize={10} fill="var(--color-muted)">
              {leftFormat(maxLeft * t)}
            </text>
          ))}

          {/* Right Y-axis */}
          {[0, 0.5, 1].map(t => (
            <text key={t} x={PLOT_W + 6} y={PLOT_H * (1 - t) + 4} textAnchor="start" fontSize={10} fill="var(--color-muted)">
              {rightFormat(maxRight * t)}
            </text>
          ))}
        </g>
      </svg>

      <div className="flex gap-5 mt-2 ml-2">
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>
          <span style={{ display: 'inline-block', width: 24, height: 2, background: leftColor, borderRadius: 1 }} />
          {leftLabel}
        </span>
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>
          <span style={{ display: 'inline-block', width: 24, height: 2, background: rightColor, borderRadius: 1 }} />
          {rightLabel}
        </span>
      </div>
    </div>
  );
}
