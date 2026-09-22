import { useCallback, useEffect, useRef, useState } from "react";
import { createLiveSession } from "../lib/geminiLive.js";

// Gemini Live ("gemini-3.5-transcribe-live") transcription engine — mirrors
// the useSpeechRecognition interface so SessionScreen can swap engines by
// key presence. supported = a Gemini key exists. Audio capture rides the
// session's existing mic stream; a public/ AudioWorklet resamples to the
// 16 kHz PCM16 the API wants.
//
// The first WS attempt after page load fails often in practice (cold TLS/
// HTTP3 to the streaming endpoint) while an immediate retry succeeds — so a
// transient error (connection-error / connection-lost / no-response) triggers
// ONE automatic session reopen before surfacing anything to the UI.
export function useGeminiLive(apiKey) {
  const [supported] = useState(
    !!apiKey && typeof WebSocket !== "undefined" && typeof AudioWorkletNode !== "undefined"
  );
  const [listening, setListening] = useState(false);
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState(null);

  const sessionRef = useRef(null);
  const ctxRef = useRef(null);
  const nodeRef = useRef(null);
  const segmentsRef = useRef([]);
  const t0Ref = useRef(0);
  const finalRef = useRef("");
  const interimRef = useRef(""); // text of the utterance currently streaming
  const gotTextRef = useRef(false);
  const watchdogRef = useRef(null);
  const retryTimerRef = useRef(null);
  const autoRetriedRef = useRef(false);
  const stoppedRef = useRef(true);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    sessionRef.current?.close();
    sessionRef.current = null;
    nodeRef.current?.disconnect();
    nodeRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setListening(false);
  }, []);

  useEffect(() => stop, [stop]);

  // startTime: shared session clock (same t0 as the audio sampler, so segment
  // timestamps align with the waveform). stream: the already-open mic stream.
  const start = useCallback(
    (startTime, stream) => {
      if (!supported || !stream) return;
      t0Ref.current = startTime ?? performance.now();
      segmentsRef.current = [];
      finalRef.current = "";
      interimRef.current = "";
      gotTextRef.current = false;
      autoRetriedRef.current = false;
      stoppedRef.current = false;
      setFinalTranscript("");
      setInterimTranscript("");
      setError(null);

      const armWatchdog = () => {
        clearTimeout(watchdogRef.current);
        // A dead-but-quiet session (bad key, rejected setup, protocol drift)
        // must not look like "listening…" forever — fail loud after 10s.
        watchdogRef.current = setTimeout(() => {
          if (gotTextRef.current) return;
          const session = sessionRef.current;
          sessionRef.current = null; // orphan the dead session
          session?.close();
          onTransient(session?.gotSetup() ? "no-text" : "no-setup", "no setupComplete");
        }, 10000);
      };

      const onTransient = (code, detail) => {
        if (stoppedRef.current) return;
        if (!autoRetriedRef.current) {
          // One silent self-heal — the capture graph keeps running and feeds
          // whatever sessionRef points at.
          autoRetriedRef.current = true;
          sessionRef.current?.close();
          sessionRef.current = null;
          retryTimerRef.current = setTimeout(() => {
            if (!stoppedRef.current) openSession();
          }, 800);
          return;
        }
        console.warn("[gemini-live] failed:", code, detail ?? "");
        setError(detail ? `${code}|${detail}` : code);
        setListening(false);
      };

      const finalizeUtterance = (fallbackText = "") => {
        const text = (fallbackText || interimRef.current).trim();
        interimRef.current = "";
        setInterimTranscript("");
        if (!text) return;
        finalRef.current += (finalRef.current ? " " : "") + text;
        setFinalTranscript(finalRef.current);
        segmentsRef.current.push({
          text,
          endedAt: (performance.now() - t0Ref.current) / 1000,
        });
      };

      function openSession() {
        const session = createLiveSession({
          apiKey,
          onText: (text, isFinal) => {
            gotTextRef.current = true;
            clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
            if (isFinal) {
              // Final text is authoritative for the utterance — replaces the
              // accumulated interim.
              finalizeUtterance(text);
              return;
            }
            // Partials: replace when cumulative, append when delta.
            const prev = interimRef.current;
            interimRef.current = text.startsWith(prev) ? text : prev + text;
            setInterimTranscript(interimRef.current);
          },
          onTurnComplete: () => finalizeUtterance(),
          onError: onTransient,
        });
        sessionRef.current = session;
        armWatchdog();
      }

      openSession();

      (async () => {
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          const ctx = new Ctx();
          ctxRef.current = ctx;
          await ctx.audioWorklet.addModule("/pcm16.worklet.js");
          const source = ctx.createMediaStreamSource(stream);
          const node = new AudioWorkletNode(ctx, "pcm16", {
            processorOptions: { sampleRate: ctx.sampleRate },
          });
          nodeRef.current = node;
          // Route through sessionRef so the auto-retry's new session keeps
          // receiving audio without rebuilding the capture graph.
          node.port.onmessage = (e) => sessionRef.current?.send(e.data);
          // Worklets only run while connected to the graph — route through a
          // zero-gain node so nothing plays back.
          const mute = ctx.createGain();
          mute.gain.value = 0;
          source.connect(node).connect(mute).connect(ctx.destination);
          setListening(true);
        } catch (err) {
          setError(err?.message ?? "capture-failed");
        }
      })();
    },
    [apiKey, supported]
  );

  const reset = useCallback(() => {
    finalRef.current = "";
    interimRef.current = "";
    segmentsRef.current = [];
    setFinalTranscript("");
    setInterimTranscript("");
  }, []);

  const getSegments = useCallback(() => segmentsRef.current, []);
  // Gemini hears fillers directly — nothing is stripped, nothing to recover.
  const getStrippedFillers = useCallback(() => ({}), []);

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
