/**
 * AISuggestionsPanel — renders the parsed suggestions array as styled cards.
 *
 * Props:
 *   suggestions — array of { text, priority: 'high'|'medium'|'low' }
 */

const PRIORITY_STYLES = {
  high:   { bg: 'rgba(239,68,68,0.1)',    color: '#dc2626', label: 'High' },
  medium: { bg: 'rgba(234,179,8,0.12)',   color: '#ca8a04', label: 'Medium' },
  low:    { bg: 'rgba(59,130,246,0.1)',   color: '#2563eb', label: 'Low' },
};

export default function AISuggestionsPanel({ suggestions }) {
  if (!suggestions?.length) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
        No recommendations available.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {suggestions.map((s, i) => {
        const style = PRIORITY_STYLES[s.priority] ?? PRIORITY_STYLES.low;
        return (
          <div
            key={i}
            className="rounded-xl p-4 flex gap-3 items-start"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <span
              className="text-xs font-semibold px-2 py-1 rounded-full shrink-0 mt-0.5"
              style={{ background: style.bg, color: style.color }}
            >
              {style.label}
            </span>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
              {s.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}
