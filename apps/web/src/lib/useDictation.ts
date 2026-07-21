/**
 * useDictation: the app's one Web Speech capability.
 *
 * Typing is hard sometimes, so every free-text field can be spoken. This hook
 * owns the whole recognition lifecycle (feature detection, interim/final merge,
 * stale-event guards, max-length capping, cleanup) and knows nothing about
 * journals, profiles, or encryption. Callers pass the current value and get
 * updates back; persistence stays entirely on the caller.
 *
 * Only one microphone can be live at a time across the app. A module-level
 * handle to the active instance's stop() enforces this: opening a second field
 * commits and stops the first, so no spoken text is dropped in the handoff.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult:
    | ((ev: {
        resultIndex: number;
        results: { isFinal: boolean; 0: { transcript: string }; length: number }[] & {
          length: number;
        };
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

type SpeechCtor = new () => SpeechRec;

function getSpeechCtor(): SpeechCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** The active instance's stop(), so a new field's mic stops (and commits) it. */
let activeStop: (() => void) | null = null;

export type UseDictation = {
  supported: boolean;
  listening: boolean;
  /** Non-error status, e.g. "Character limit reached, dictation stopped." */
  notice: string | null;
  error: string | null;
  start: () => void;
  stop: () => void;
};

export type DictationOptions = {
  /** Latest field value, so appended speech builds on what is already there. */
  getValue: () => string;
  /** Called with the merged text as the person speaks. */
  onChange: (text: string) => void;
  /** Called once when a dictation session ends, so the caller can persist. */
  onCommit?: (text: string) => void;
  /** Hard character cap; dictation stops and notices when reached. */
  maxLength?: number;
  lang?: string;
};

export function useDictation(options: DictationOptions): UseDictation {
  const { getValue, lang = "en-US", maxLength } = options;
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs keep the recognition callbacks reading the freshest closures without
  // restarting the recognizer.
  const recRef = useRef<SpeechRec | null>(null);
  const baseRef = useRef("");
  // Most recent merged text this session, committed verbatim on stop (never the
  // stale prop value).
  const latestRef = useRef("");
  const listeningRef = useRef(false);
  const generationRef = useRef(0);
  const optsRef = useRef(options);
  optsRef.current = options;

  const supported = typeof window !== "undefined" && getSpeechCtor() != null;

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
      recRef.current = null;
    }
    if (activeStop === stopRef.current) activeStop = null;
    generationRef.current += 1;
    if (listeningRef.current) {
      listeningRef.current = false;
      optsRef.current.onCommit?.(latestRef.current);
    }
    setListening(false);
  }, []);

  // Stable pointer to this instance's stop, used for the module-level handle.
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const start = useCallback(() => {
    const Ctor = getSpeechCtor();
    if (!Ctor) {
      setError("Dictation is not available in this browser. The keyboard still believes in you.");
      return;
    }
    // Commit and stop any other field's mic (or our own) before starting fresh.
    if (activeStop && activeStop !== stopRef.current) activeStop();
    if (recRef.current) stop();

    setError(null);
    setNotice(null);
    generationRef.current += 1;
    const generation = generationRef.current;
    baseRef.current = getValue();
    latestRef.current = baseRef.current;

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    rec.onresult = (ev) => {
      if (generation !== generationRef.current || recRef.current !== rec) return;
      let interim = "";
      let finals = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]!;
        if (r.isFinal) finals += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (finals) baseRef.current = (baseRef.current + " " + finals).trim();
      let next = (baseRef.current + (interim ? " " + interim : "")).trim();
      if (maxLength != null && next.length >= maxLength) {
        next = next.slice(0, maxLength);
        baseRef.current = next;
        latestRef.current = next;
        optsRef.current.onChange(next);
        setNotice("Character limit reached, dictation stopped.");
        stop();
        return;
      }
      latestRef.current = next;
      optsRef.current.onChange(next);
    };
    rec.onerror = () => {
      if (generation !== generationRef.current) return;
      setError("Dictation stopped. Check the microphone permission, then try again.");
      stop();
    };
    rec.onend = () => {
      if (generation !== generationRef.current) return;
      stop();
    };
    recRef.current = rec;
    activeStop = stopRef.current;
    try {
      rec.start();
      listeningRef.current = true;
      setListening(true);
    } catch {
      setError("Dictation could not start. Check the microphone permission and try again.");
      recRef.current = null;
      if (activeStop === stopRef.current) activeStop = null;
    }
  }, [getValue, lang, maxLength, stop]);

  // Release the mic if the component unmounts mid-session.
  useEffect(() => stop, [stop]);

  return { supported, listening, notice, error, start, stop };
}
