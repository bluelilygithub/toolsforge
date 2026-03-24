import { useState, useEffect, useRef } from 'react';
import { useIcon } from '../providers/IconProvider';
import useStream from '../hooks/useStream';
import api from '../utils/apiClient';

const TOOL_SLUG = 'chat';

function ModelPicker({ models, selected, onChange, disabled }) {
  if (!models.length) return null;
  return (
    <select
      value={selected}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className="text-sm rounded-lg px-3 py-1.5 border outline-none"
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-text)',
      }}
    >
      {models.map(m => (
        <option key={m.id} value={m.id}>{m.label}</option>
      ))}
    </select>
  );
}

function Message({ role, text }) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className="max-w-[75%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap"
        style={{
          background: isUser ? 'var(--color-primary)' : 'var(--color-surface)',
          color: isUser ? '#fff' : 'var(--color-text)',
          border: isUser ? 'none' : '1px solid var(--color-border)',
        }}
      >
        {text}
      </div>
    </div>
  );
}

function UsageBadge({ usage }) {
  if (!usage) return null;
  const cost = usage.costUsd < 0.01
    ? `$${usage.costUsd.toFixed(4)}`
    : `$${usage.costUsd.toFixed(2)}`;
  return (
    <div className="flex justify-center mt-1 mb-2">
      <span
        className="text-xs px-2 py-0.5 rounded-full"
        style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
      >
        {usage.inputTokens + usage.outputTokens} tokens · {cost}
      </span>
    </div>
  );
}

export default function ChatPage() {
  const getIcon = useIcon();
  const { send, stop, reset, streaming, content, usage, error } = useStream(TOOL_SLUG);

  const [models, setModels]         = useState([]);
  const [selectedModel, setSelected] = useState('');
  const [history, setHistory]       = useState([]);
  const [input, setInput]           = useState('');
  const [pendingUsage, setPendingUsage] = useState(null);

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  // Load permitted models once
  useEffect(() => {
    api.get(`/api/tools/${TOOL_SLUG}/permitted-models`)
      .then(r => r.json())
      .then(({ models: ms }) => {
        setModels(ms ?? []);
        if (ms?.length) setSelected(ms[0].id);
      })
      .catch(() => {});
  }, []);

  // Scroll to bottom as content arrives
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [content, history]);

  // When streaming finishes, commit the assistant turn to history
  useEffect(() => {
    if (!streaming && content) {
      setHistory(prev => [...prev, { role: 'assistant', content }]);
      setPendingUsage(usage);
      reset();
    }
  }, [streaming]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSend() {
    const text = input.trim();
    if (!text || !selectedModel || streaming) return;

    setInput('');
    setPendingUsage(null);

    const userMsg = { role: 'user', content: text };
    const nextHistory = [...history, userMsg];
    setHistory(nextHistory);

    await send(nextHistory, selectedModel);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleNewChat() {
    stop();
    reset();
    setHistory([]);
    setPendingUsage(null);
    setInput('');
  }

  const isEmpty = history.length === 0 && !streaming && !content;

  return (
    <div className="flex flex-col h-full" style={{ maxHeight: 'calc(100vh - 44px)' }}>

      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            AI Chat
          </h1>
          <ModelPicker
            models={models}
            selected={selectedModel}
            onChange={setSelected}
            disabled={streaming}
          />
        </div>
        <button
          onClick={handleNewChat}
          className="text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={{
            background: 'var(--color-surface)',
            color: 'var(--color-muted)',
            border: '1px solid var(--color-border)',
          }}
        >
          New chat
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: 'var(--color-muted)' }}>
            {getIcon('message-square', { size: 32 })}
            <p className="text-sm">Start a conversation</p>
            {!models.length && (
              <p className="text-xs">You don't have access to any models for this tool.</p>
            )}
          </div>
        )}

        {history.map((msg, i) => (
          <Message key={i} role={msg.role} text={msg.content} />
        ))}

        {/* Streaming assistant turn */}
        {(streaming || content) && (
          <Message role="assistant" text={content || '…'} />
        )}

        {/* Usage badge after last assistant turn */}
        {!streaming && pendingUsage && <UsageBadge usage={pendingUsage} />}

        {error && (
          <div
            className="text-xs text-center py-2 px-4 rounded-lg mb-2"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
          >
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div
        className="flex-shrink-0 border-t px-4 py-3"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div
          className="flex items-end gap-2 rounded-xl border px-3 py-2"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message AI Chat…"
            disabled={streaming || !models.length}
            className="flex-1 resize-none text-sm bg-transparent outline-none"
            style={{
              color: 'var(--color-text)',
              maxHeight: '160px',
              lineHeight: '1.5',
            }}
            onInput={e => {
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
          />
          {streaming ? (
            <button
              onClick={stop}
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
              style={{ background: 'var(--color-primary)', color: '#fff' }}
            >
              {getIcon('square', { size: 14 })}
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || !selectedModel}
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-40"
              style={{ background: 'var(--color-primary)', color: '#fff' }}
            >
              {getIcon('send', { size: 14 })}
            </button>
          )}
        </div>
        <p className="text-xs mt-1.5 text-center" style={{ color: 'var(--color-muted)' }}>
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
