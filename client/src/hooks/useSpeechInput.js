import { useState, useRef, useEffect } from 'react';

/**
 * Headless hook — browser-native speech-to-text (Web Speech API).
 *
 * Three-layer pattern: this is the logic layer.
 * UI primitive: VoiceInputButton
 * Integration: ChatPage (or any future tool)
 *
 * @returns {{
 *   listening: boolean,
 *   transcript: string,   // accumulated text since start() — final + interim
 *   start: function,
 *   stop: function,
 *   clear: function,      // reset transcript after committing to input
 *   supported: boolean,
 * }}
 */
export function useSpeechInput() {
  const [listening, setListening]   = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef(null);
  const finalRef       = useRef('');   // accumulated final segments

  const supported =
    typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  function start() {
    if (!supported || listening) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.continuous      = true;
    recognition.interimResults  = true;
    recognition.lang            = navigator.language || 'en-US';

    finalRef.current = '';
    setTranscript('');

    recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalRef.current += e.results[i][0].transcript;
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      setTranscript(finalRef.current + interim);
    };

    recognition.onend   = () => setListening(false);
    recognition.onerror = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  function stop() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function clear() {
    finalRef.current = '';
    setTranscript('');
  }

  // Cleanup on unmount
  useEffect(() => () => recognitionRef.current?.stop(), []);

  return { listening, transcript, start, stop, clear, supported };
}
