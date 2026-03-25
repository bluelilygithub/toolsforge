import { useIcon } from '../providers/IconProvider';

/**
 * UI primitive — read-aloud controls.
 *
 * Three-layer pattern: this is the UI layer.
 * Logic hook: useReadAloud
 * Integration: any tool that wants TTS on AI responses (currently ChatPage)
 *
 * Props:
 *   speaking  {boolean}  TTS is active
 *   paused    {boolean}  TTS is paused
 *   onSpeak   {function} start reading
 *   onPause   {function}
 *   onResume  {function}
 *   onStop    {function}
 */
export default function ReadAloudButton({ speaking, paused, onSpeak, onPause, onResume, onStop }) {
  const getIcon = useIcon();

  if (!speaking) {
    return (
      <button
        onClick={onSpeak}
        className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors hover:opacity-70"
        style={{ color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
        title="Read aloud"
      >
        {getIcon('volume-2', { size: 13 })}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={paused ? onResume : onPause}
        className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors hover:opacity-80"
        style={{
          color: 'var(--color-primary)',
          border: '1px solid var(--color-primary)',
          background: 'rgba(var(--color-primary-rgb), 0.07)',
        }}
        title={paused ? 'Resume' : 'Pause'}
      >
        {getIcon(paused ? 'play' : 'pause', { size: 13 })}
      </button>
      <button
        onClick={onStop}
        className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors hover:opacity-70"
        style={{ color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
        title="Stop reading"
      >
        {getIcon('x', { size: 13 })}
      </button>
    </div>
  );
}
