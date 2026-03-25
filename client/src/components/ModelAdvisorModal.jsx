import { useState, useEffect } from 'react';
import { useIcon } from '../providers/IconProvider';

export default function ModelAdvisorModal({
  isOpen,
  currentModelName,
  reason,
  suggestedModels,
  onSwitch,
  onConfirm,
  onDismiss,
}) {
  const [selected, setSelected] = useState(null);
  const getIcon = useIcon();

  useEffect(() => {
    if (isOpen && suggestedModels?.length > 0) {
      setSelected(suggestedModels[0].id);
    } else if (isOpen) {
      setSelected(null);
    }
  }, [isOpen, suggestedModels]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onDismiss]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-6 space-y-4"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getIcon('sparkles', { size: 16, style: { color: 'var(--color-primary)' } })}
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              Model Advisor
            </h2>
          </div>
          <button
            onClick={onDismiss}
            className="opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
          >
            {getIcon('x', { size: 16 })}
          </button>
        </div>

        {/* Reason */}
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          {reason}
        </p>

        {/* Current model */}
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
          style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
        >
          <span style={{ color: 'var(--color-muted)' }}>Current model:</span>
          <span className="font-medium" style={{ color: 'var(--color-text)' }}>
            {currentModelName}
          </span>
        </div>

        {/* Suggested models */}
        {suggestedModels?.length > 0 && (
          <div className="space-y-2">
            <p
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--color-muted)' }}
            >
              Suggested
            </p>
            {suggestedModels.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelected(m.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left"
                style={{
                  background: selected === m.id
                    ? 'rgba(var(--color-primary-rgb), 0.08)'
                    : 'var(--color-bg)',
                  borderColor: selected === m.id
                    ? 'var(--color-primary)'
                    : 'var(--color-border)',
                }}
              >
                {m.emoji && (
                  <span className="text-base flex-shrink-0 select-none">{m.emoji}</span>
                )}
                <span className="text-sm font-medium flex-1" style={{ color: 'var(--color-text)' }}>
                  {m.name}
                </span>
                {selected === m.id && (
                  <span style={{ color: 'var(--color-primary)' }}>
                    {getIcon('check', { size: 14 })}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          {selected && (
            <button
              onClick={() => onSwitch(selected)}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}
            >
              Switch &amp; Send
            </button>
          )}
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' }}
          >
            Keep &amp; Send
          </button>
        </div>
      </div>
    </div>
  );
}
