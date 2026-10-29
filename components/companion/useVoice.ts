"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceLang = "en-IN" | "hi-IN";

/** Strips light markdown so speech sounds natural. */
export function toSpeakableText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/[([]\s*(?:pp?\.|pages?)\s*\d+(?:\s*[–—-]\s*\d+)?\s*[)\]]/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

/**
 * Browser-native voice (Web Speech API). No external service or key; degrades to text-only when unsupported.
 */
export function useVoice() {
  const [canListen, setCanListen] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const w = window as any;
    setCanListen(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
    setCanSpeak("speechSynthesis" in window && typeof (window as any).SpeechSynthesisUtterance === "function");
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {}
      try {
        window.speechSynthesis?.cancel();
      } catch {}
    };
  }, []);

  const listen = useCallback((lang: VoiceLang, onText: (text: string) => void, onError?: (message: string) => void) => {
    const w = window as any;
    const Recognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Recognition) return;
    try {
      recognitionRef.current?.abort();
    } catch {}
    const rec = new Recognition();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (typeof transcript === "string" && transcript.trim()) onText(transcript.trim());
    };
    rec.onerror = (event: any) => {
      if (event?.error && event.error !== "aborted" && event.error !== "no-speech") {
        onError?.(event.error === "not-allowed" ? "Microphone permission was denied." : "Voice input didn't work. Please type instead.");
      }
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }, []);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {}
    setListening(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    const spoken = toSpeakableText(text);
    if (!spoken) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = /[ऀ-ॿ]/.test(spoken) ? "hi-IN" : "en-IN";
    utterance.rate = 1;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    try {
      window.speechSynthesis?.cancel();
    } catch {}
    setSpeaking(false);
  }, []);

  return { canListen, canSpeak, listening, speaking, listen, stopListening, speak, stopSpeaking };
}
