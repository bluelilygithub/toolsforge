/**
 * useStream — client-side hook for the generic SSE streaming endpoint.
 *
 * Usage:
 *   const { send, streaming, content, usage, error, reset } = useStream('chat');
 *
 *   await send([{ role: 'user', content: 'Hello' }], 'claude-sonnet-4-6');
 *
 * The hook uses fetch + ReadableStream (not EventSource) because SSE over POST
 * is not supported by the native EventSource API.
 *
 * SSE event types consumed:
 *   { type: 'text',  text: '...' }
 *   { type: 'usage', inputTokens, outputTokens, costUsd, sessionTotal, dailyTotal, warnings }
 *   { type: 'error', error: '...' }
 *   '[DONE]'
 */

import { useState, useRef, useCallback } from 'react';
import useAuthStore from '../store/authStore';

export default function useStream(toolSlug) {
  const [streaming, setStreaming] = useState(false);
  const [content, setContent]     = useState('');
  const [usage, setUsage]         = useState(null);
  const [error, setError]         = useState(null);
  const abortRef = useRef(null);

  const reset = useCallback(() => {
    setContent('');
    setUsage(null);
    setError(null);
  }, []);

  const send = useCallback(async (messages, modelId, { system, maxTokens } = {}) => {
    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStreaming(true);
    setContent('');
    setUsage(null);
    setError(null);

    const { token } = useAuthStore.getState();

    try {
      const res = await fetch(`/api/tools/${toolSlug}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ model: modelId, messages, system, maxTokens }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE lines end with \n\n — split and process each complete event
        const parts = buffer.split('\n\n');
        buffer = parts.pop(); // last element may be incomplete

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();

          if (raw === '[DONE]') break;

          try {
            const event = JSON.parse(raw);
            if (event.type === 'text') {
              setContent(prev => prev + event.text);
            } else if (event.type === 'usage') {
              setUsage(event);
            } else if (event.type === 'error') {
              setError(event.error);
            }
          } catch {
            // ignore malformed events
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message ?? 'Stream failed');
      }
    } finally {
      setStreaming(false);
    }
  }, [toolSlug]);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      setStreaming(false);
    }
  }, []);

  return { send, stop, reset, streaming, content, usage, error };
}
