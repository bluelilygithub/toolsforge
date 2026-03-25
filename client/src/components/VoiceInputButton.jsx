import { useIcon } from '../providers/IconProvider';

/**
 * UI primitive — voice input control.
 *
 * Three-layer pattern: this is the UI layer.
 * Logic hook: useSpeechInput
 * Integration: any tool that wants voice input (currently ChatPage)
 *
 * Props:
 *   listening  {boolean}  recording is active
 *   onStart    {function} called when mic button clicked
 *   onStop     {function} called when Stop button clicked
 *   disabled   {boolean}  disables the button (e.g. while AI is streaming)
 */
export default function VoiceInputButton({ listening, onStart, onStop, disabled }) {
  const getIcon = useIcon();

  if (listening) {
    return (
      <button
        onClick={onStop}
        className="flex-shrink-0 flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-medium transition-colors"
        style={{
          background: 'rgba(239,68,68,0.1)',
          color: '#ef4444',
          border: '1px solid rgba(239,68,68,0.3)',
        }}
        title="Stop recording"
      >
        <span
          className="w-2 h-2 rounded-full animate-pulse flex-shrink-0"
          style={{ background: '#ef4444' }}
        />
        Stop
      </button>
    );
  }

  return (
    <button
      onClick={onStart}
      disabled={disabled}
      className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:opacity-70 disabled:opacity-40"
      style={{
        color: 'var(--color-muted)',
        border: '1px solid var(--color-border)',
      }}
      title="Voice input"
    >
      {getIcon('mic', { size: 14 })}
    </button>
  );
}
