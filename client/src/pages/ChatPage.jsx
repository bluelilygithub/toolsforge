import { useState, useEffect, useRef } from 'react';
import { useIcon } from '../providers/IconProvider';
import useStream from '../hooks/useStream';
import api from '../utils/apiClient';
import ModelAdvisorModal from '../components/ModelAdvisorModal';
import VoiceInputButton from '../components/VoiceInputButton';
import ReadAloudButton from '../components/ReadAloudButton';
import { useSpeechInput } from '../hooks/useSpeechInput';
import { useReadAloud } from '../hooks/useReadAloud';
import { useClipboardMedia } from '../hooks/useClipboardMedia';
import { useFileAttachment } from '../hooks/useFileAttachment';

const TOOL_SLUG = 'chat';

// ─── Timezone resolution ──────────────────────────────────────────────────────
// Priority: user setting > org default > browser
function buildSystemPrompt(timezone) {
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateStr = new Date().toLocaleDateString('en', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz,
  });
  const timeStr = new Date().toLocaleTimeString('en', {
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone: tz,
  });
  return `Today is ${dateStr}. Current time: ${timeStr}.`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function Message({ role, content, images, receivedAt, timezone }) {
  const isUser = role === 'user';
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-[75%] ${isUser ? '' : 'w-full'}`}>
        {/* User inline images */}
        {isUser && images?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-end mb-1.5">
            {images.map(img => (
              <img
                key={img.id}
                src={img.preview}
                alt="attachment"
                className="w-20 h-20 object-cover rounded-xl border"
                style={{ borderColor: 'rgba(255,255,255,0.3)' }}
              />
            ))}
          </div>
        )}

        {/* Message bubble */}
        {content && (
          <div
            className="rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap"
            style={{
              background: isUser ? 'var(--color-primary)' : 'var(--color-surface)',
              color: isUser ? '#fff' : 'var(--color-text)',
              border: isUser ? 'none' : '1px solid var(--color-border)',
            }}
          >
            {content}
          </div>
        )}

        {/* Date stamp — assistant messages only */}
        {!isUser && receivedAt && (
          <p className="text-xs mt-1 px-1" style={{ color: 'var(--color-muted)', opacity: 0.6 }}>
            {new Date(receivedAt).toLocaleString('en', {
              month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit',
              timeZone: tz, timeZoneName: 'short',
            })}
          </p>
        )}
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function ChatPage() {
  const getIcon = useIcon();
  const { send, stop, reset, streaming, content, usage, error } = useStream(TOOL_SLUG);

  const [models, setModels]             = useState([]);
  const [selectedModel, setSelected]    = useState('');
  const [history, setHistory]           = useState([]);
  const [input, setInput]               = useState('');
  const [pendingUsage, setPendingUsage] = useState(null);
  const [timezone, setTimezone]         = useState('');    // resolved timezone

  // Model Advisor
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [advisorData, setAdvisorData] = useState(null);

  // Voice input
  const {
    listening, transcript,
    start: startListening, stop: stopListening, clear: clearTranscript,
    supported: voiceSupported,
  } = useSpeechInput();
  const voiceBaseRef = useRef('');

  // Read aloud
  const { speaking, paused, speak, pause, resume, stop: stopReading, supported: readAloudSupported } = useReadAloud();

  // Clipboard image paste
  const {
    images: pastedImages,
    addFromPaste,
    removeImage: removePastedImage,
    clear: clearPastedImages,
  } = useClipboardMedia();

  // File picker
  const {
    files: attachedFiles,
    images: attachedImages,
    openPicker,
    removeFile,
    removeImage: removeAttachedImage,
    clear: clearAttachments,
  } = useFileAttachment();

  // All inline images = pasted + file-picked images
  const allImages = [...pastedImages, ...attachedImages];

  const bottomRef   = useRef(null);
  const textareaRef = useRef(null);

  // ── Load permitted models + timezone on mount ──────────────────────────────
  useEffect(() => {
    api.get(`/api/tools/${TOOL_SLUG}/permitted-models`)
      .then(r => r.json())
      .then(({ models: ms }) => {
        setModels(ms ?? []);
        if (ms?.length) setSelected(ms[0].id);
      })
      .catch(() => {});

    // Resolve timezone: user setting > org default > browser
    Promise.all([
      api.get('/api/user-settings').then(r => r.json()).catch(() => ({})),
      api.get('/api/admin/app-settings').then(r => r.json()).catch(() => ({})),
    ]).then(([userSettings, appSettings]) => {
      const tz =
        userSettings.timezone ||
        appSettings.default_timezone ||
        Intl.DateTimeFormat().resolvedOptions().timeZone;
      setTimezone(tz);
    });
  }, []);

  // ── Scroll to bottom ───────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [content, history]);

  // ── Commit streaming response to history ───────────────────────────────────
  useEffect(() => {
    if (!streaming && content) {
      setHistory(prev => [...prev, {
        role: 'assistant',
        content,
        receivedAt: new Date().toISOString(),
      }]);
      setPendingUsage(usage);
      reset();
    }
  }, [streaming]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Voice transcript → input ───────────────────────────────────────────────
  useEffect(() => {
    if (listening && transcript) {
      const base = voiceBaseRef.current;
      setInput(base ? base + ' ' + transcript : transcript);
    }
  }, [transcript, listening]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleVoiceStart() { voiceBaseRef.current = input; startListening(); }
  function handleVoiceStop() {
    const base = voiceBaseRef.current;
    if (transcript) setInput(base ? base + ' ' + transcript : transcript);
    clearTranscript();
    stopListening();
  }

  // ── Send ───────────────────────────────────────────────────────────────────
  async function handleSend(modelOverride) {
    const text = input.trim();
    if (!text && allImages.length === 0 && attachedFiles.length === 0) return;
    if (!selectedModel || streaming) return;

    stopReading();
    if (listening) { stopListening(); clearTranscript(); }

    const modelToUse = modelOverride ?? selectedModel;

    // Build message text — prepend text file contents
    let fullText = text;
    if (attachedFiles.length > 0) {
      const fileContext = attachedFiles
        .map(f => `[File: ${f.name}]\n${f.content}`)
        .join('\n\n---\n\n');
      fullText = fileContext + (fullText ? '\n\n---\n\n' + fullText : '');
    }

    setInput('');
    clearPastedImages();
    clearAttachments();
    setPendingUsage(null);

    // Store user message in history (with images for display)
    const imageSnapshot = [...allImages];
    const userMsg = { role: 'user', content: fullText, images: imageSnapshot };
    const nextHistory = [...history, userMsg];
    setHistory(nextHistory);

    // Build Anthropic-format messages (multipart for image turns)
    const apiMessages = nextHistory.map(msg => {
      if (msg.role === 'user' && msg.images?.length > 0) {
        const parts = [];
        for (const img of msg.images) {
          parts.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } });
        }
        if (msg.content) parts.push({ type: 'text', text: msg.content });
        return { role: 'user', content: parts };
      }
      return { role: msg.role, content: msg.content };
    });

    const system = buildSystemPrompt(timezone);
    await send(apiMessages, modelToUse, { system });
  }

  async function checkModelBeforeSend() {
    const text = input.trim();
    const hasContent = text || allImages.length > 0 || attachedFiles.length > 0;
    if (!hasContent || !selectedModel || streaming) return;

    try {
      const res = await api.post(`/api/tools/${TOOL_SLUG}/analyse-prompt`, {
        prompt: text,
        currentModelId: selectedModel,
      });
      const data = await res.json();
      if (data?.mismatch) {
        setAdvisorData(data);
        setAdvisorOpen(true);
        return;
      }
    } catch { /* fall through */ }

    handleSend();
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      checkModelBeforeSend();
    }
  }

  async function handlePaste(e) {
    const handled = await addFromPaste(e);
    if (handled) return; // image consumed — don't let textarea process it
  }

  function handleNewChat() {
    stop();
    reset();
    stopReading();
    if (listening) { stopListening(); clearTranscript(); }
    clearPastedImages();
    clearAttachments();
    setHistory([]);
    setPendingUsage(null);
    setInput('');
  }

  const isEmpty = history.length === 0 && !streaming && !content;
  const lastMsg = history[history.length - 1];

  return (
    <div className="flex flex-col h-full" style={{ maxHeight: 'calc(100vh - 44px)' }}>

      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>AI Chat</h1>
          <ModelPicker models={models} selected={selectedModel} onChange={setSelected} disabled={streaming} />
        </div>
        <button
          onClick={handleNewChat}
          className="text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
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
          <Message key={i} role={msg.role} content={msg.content} images={msg.images} receivedAt={msg.receivedAt} timezone={timezone} />
        ))}

        {/* Read-aloud controls below last completed assistant response */}
        {!streaming && readAloudSupported && lastMsg?.role === 'assistant' && (
          <div className="flex justify-start pl-1 mb-1 -mt-1">
            <ReadAloudButton
              speaking={speaking}
              paused={paused}
              onSpeak={() => speak(lastMsg.content)}
              onPause={pause}
              onResume={resume}
              onStop={stopReading}
            />
          </div>
        )}

        {/* Streaming assistant turn */}
        {(streaming || content) && (
          <Message role="assistant" content={content || '…'} timezone={timezone} />
        )}

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
      <div className="flex-shrink-0 border-t px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>

        {/* Image thumbnails */}
        {allImages.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {allImages.map(img => (
              <div key={img.id} className="relative">
                <img
                  src={img.preview}
                  alt="attachment"
                  className="w-14 h-14 object-cover rounded-lg border"
                  style={{ borderColor: 'var(--color-border)' }}
                />
                <button
                  onClick={() => {
                    removePastedImage(img.id);
                    removeAttachedImage(img.id);
                  }}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center text-xs"
                  style={{ background: '#ef4444', color: '#fff' }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Text file pills */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachedFiles.map(f => (
              <span
                key={f.id}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              >
                {getIcon('file-text', { size: 11 })}
                {f.name}
                <button
                  onClick={() => removeFile(f.id)}
                  className="ml-0.5 opacity-50 hover:opacity-100"
                  style={{ color: 'var(--color-muted)' }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

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
            onPaste={handlePaste}
            placeholder="Message AI Chat…"
            disabled={streaming || !models.length}
            className="flex-1 resize-none text-sm bg-transparent outline-none"
            style={{ color: 'var(--color-text)', maxHeight: '160px', lineHeight: '1.5' }}
            onInput={e => {
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
          />

          {/* File picker */}
          <button
            onClick={openPicker}
            disabled={streaming}
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:opacity-70 disabled:opacity-40"
            style={{ color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
            title="Attach file"
          >
            {getIcon('paperclip', { size: 14 })}
          </button>

          {/* Voice input */}
          {voiceSupported && (
            <VoiceInputButton
              listening={listening}
              onStart={handleVoiceStart}
              onStop={handleVoiceStop}
              disabled={streaming}
            />
          )}

          {/* Send / Stop */}
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
              onClick={checkModelBeforeSend}
              disabled={!input.trim() && allImages.length === 0 && attachedFiles.length === 0}
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

      <ModelAdvisorModal
        isOpen={advisorOpen}
        currentModelName={models.find(m => m.id === selectedModel)?.name ?? selectedModel}
        reason={advisorData?.reason ?? ''}
        suggestedModels={advisorData?.suggestedModels ?? []}
        onSwitch={(modelId) => {
          setAdvisorOpen(false);
          setSelected(modelId);
          handleSend(modelId);
        }}
        onConfirm={() => { setAdvisorOpen(false); handleSend(); }}
        onDismiss={() => setAdvisorOpen(false)}
      />
    </div>
  );
}
