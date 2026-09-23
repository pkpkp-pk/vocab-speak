import { useCallback, useEffect, useRef, useState } from "react";
import { diffStrippedFillers } from "../lib/analyzeSpeech.js";

// Wraps the browser's SpeechRecognition API (Chrome/Edge; Safari partial support).
// Falls back gracefully — `supported` tells the UI whether to show mic-based features.

const SpeechRecognitionAPI =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

export function useSpeechRecognition() {
  const [supported] = useState(!!SpeechRecognitionAPI);
  const [listening, setListening] = useState(false);
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const finalRef = useRef("");
  const shouldRestartRef = useRef(false);
  // Per-final-result timing, for aligning the transcript to the waveform.
  const segmentsRef = useRef([]);
  const t0Ref = useRef(0);
  // Latest interim text per result index — diffed against the final text when
  // a result finalizes, to recover the "um"/"uh" Chrome strips (see
  // diffStrippedFillers in analyzeSpeech.js).
  const interimSnapshotsRef = useRef(new Map());
  const lastResultIndexRef = useRef(0);
  // Disfluencies recovered so far, { word: count }.
  const strippedFillersRef = useRef({});

  useEffect(() => {
    if (!SpeechRecognitionAPI) return undefined;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      // A drop in resultIndex means the results list was rebuilt (the
      // recognizer auto-stopped and onend restarted it) — interim snapshots
      // from the old list are stale and must go.
      if (event.resultIndex < lastResultIndexRef.current) interimSnapshotsRef.current.clear();
      lastResultIndexRef.current = event.resultIndex;

      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalRef.current += transcript + " ";
          // Chrome typically finalizes a segment when the speaker pauses, so
          // this arrival time anchors the segment to the waveform (with a
          // small lag, compensated for in alignTranscript).
          segmentsRef.current.push({
            text: transcript.trim(),
            endedAt: (performance.now() - t0Ref.current) / 1000,
          });
          // The interim snapshot often still has the "um"/"uh" that the
          // final's cleanup dropped — keep whatever vanished.
          const snapshot = interimSnapshotsRef.current.get(i);
          if (snapshot) {
            interimSnapshotsRef.current.delete(i);
            for (const [word, n] of Object.entries(diffStrippedFillers(snapshot, transcript))) {
              strippedFillersRef.current[word] = (strippedFillersRef.current[word] ?? 0) + n;
            }
          }
        } else {
          interimSnapshotsRef.current.set(i, transcript);
          interim += transcript;
        }
      }
      setFinalTranscript(finalRef.current);
      setInterimTranscript(interim);
    };

    recognition.onerror = (event) => {
      // "no-speech" fires often during natural pauses — not a real error.
      if (event.error === "no-speech") return;
      // Fatal errors will never recover by restarting — stop the
      // onend→start loop from hammering them forever.
      const FATAL = ["not-allowed", "audio-capture", "service-not-allowed", "language-not-supported"];
      if (FATAL.includes(event.error)) shouldRestartRef.current = false;
      setError(event.error);
    };

    recognition.onend = () => {
      // Some browsers auto-stop after silence; restart seamlessly if the
      // user hasn't intentionally ended the session yet.
      if (shouldRestartRef.current) {
        try {
          recognition.start();
        } catch {
          /* already started */
        }
      } else {
        setListening(false);
      }
    };

    recognitionRef.current = recognition;
    return () => {
      shouldRestartRef.current = false;
      recognition.stop();
    };
  }, []);

  // startTime lets the caller share one clock with the audio sampler, so
  // segment timestamps and audio samples live on the same timeline.
  const start = useCallback((startTime) => {
    if (!recognitionRef.current) return;
    t0Ref.current = startTime ?? performance.now();
    segmentsRef.current = [];
    interimSnapshotsRef.current.clear();
    lastResultIndexRef.current = 0;
    strippedFillersRef.current = {};
    finalRef.current = "";
    setFinalTranscript("");
    setInterimTranscript("");
    setError(null);
    shouldRestartRef.current = true;
    try {
      recognitionRef.current.start();
      setListening(true);
    } catch {
      /* already running */
    }
  }, []);

  const stop = useCallback(() => {
    if (!recognitionRef.current) return;
    shouldRestartRef.current = false;
    recognitionRef.current.stop();
    setListening(false);
  }, []);

  const reset = useCallback(() => {
    finalRef.current = "";
    segmentsRef.current = [];
    interimSnapshotsRef.current.clear();
    lastResultIndexRef.current = 0;
    strippedFillersRef.current = {};
    setFinalTranscript("");
    setInterimTranscript("");
  }, []);

  const getSegments = useCallback(() => segmentsRef.current, []);
  const getStrippedFillers = useCallback(() => strippedFillersRef.current, []);

  return {
    supported,
    listening,
    finalTranscript,
    interimTranscript,
    fullTranscript: (finalTranscript + " " + interimTranscript).trim(),
    error,
    start,
    stop,
    reset,
    getSegments,
    getStrippedFillers,
  };
}
