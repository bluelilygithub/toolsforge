import { useState } from 'react';
import { stripForSpeech } from '../utils/stripForSpeech';

/**
 * Headless hook — browser-native text-to-speech (speechSynthesis).
 *
 * Three-layer pattern: this is the logic layer.
 * UI primitive: ReadAloudButton
 * Integration: ChatPage (or any future tool)
 *
 * speak(text) cancels any in-progress utterance and starts a new one.
 * Only the most recent call to speak() is ever active.
 *
 * @returns {{
 *   speaking: boolean,
 *   paused:   boolean,
 *   speak:    function(text: string),
 *   pause:    function,
 *   resume:   function,
 *   stop:     function,
 *   supported: boolean,
 * }}
 */
export function useReadAloud() {
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused]     = useState(false);

  const supported =
    typeof window !== 'undefined' && 'speechSynthesis' in window;

  function speak(text) {
    if (!supported || !text) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(stripForSpeech(text));
    utterance.onstart = () => { setSpeaking(true);  setPaused(false); };
    utterance.onend   = () => { setSpeaking(false); setPaused(false); };
    utterance.onerror = () => { setSpeaking(false); setPaused(false); };
    window.speechSynthesis.speak(utterance);
  }

  function pause() {
    if (!speaking || paused) return;
    window.speechSynthesis.pause();
    setPaused(true);
  }

  function resume() {
    if (!paused) return;
    window.speechSynthesis.resume();
    setPaused(false);
  }

  function stop() {
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
  }

  return { speaking, paused, speak, pause, resume, stop, supported };
}
