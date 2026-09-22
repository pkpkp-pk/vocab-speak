import { useCallback, useEffect, useRef, useState } from "react";
import { createLiveSession } from "../lib/geminiLive.js";

// Gemini Live ("gemini-3.5-transcribe-live") transcription engine — mirrors
// the useSpeechRecognition interface so SessionScreen can swap engines by
// key presence. supported = a Gemini key exists. Audio capture rides the
// session's existing mic stream; a public/ AudioWorklet resamples to the
// 16 kHz PCM16 the API wants.
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

  const stop = useCallback(() => {
    clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
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
      setFinalTranscript("");
      setInterimTranscript("");
      setError(null);

      const session = createLiveSession({
        apiKey,
        onText: (text) => {
          gotTextRef.current = true;
          clearTimeout(watchdogRef.current);
          watchdogRef.current = null;
          // Chunks arrive cumulative-per-utterance in some builds, delta in
          // others — replace when cumulative, append otherwise.
          const prev = interimRef.current;
          interimRef.current = text.startsWith(prev) ? text : prev + text;
          setInterimTranscript(interimRef.current);
        },
        onTurnComplete: () => {
          const text = interimRef.current.trim();
          interimRef.current = "";
          setInterimTranscript("");
          if (!text) return;
          finalRef.current += (finalRef.current ? " " : "") + text;
          setFinalTranscript(finalRef.current);
          segmentsRef.current.push({
            text,
            endedAt: (performance.now() - t0Ref.current) / 1000,
          });
        },
        onError: (code) => {
          setError(code);
          setListening(false);
        },
      });
      sessionRef.current = session;

      // A dead-but-quiet session (bad key, rejected setup, protocol drift)
      // must not look like "listening…" forever — fail loud after 10s.
      gotTextRef.current = false;
      clearTimeout(watchdogRef.current);
      watchdogRef.current = setTimeout(() => {
        if (!gotTextRef.current) {
          setError("no-response");
          setListening(false);
        }
      }, 10000);

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
          node.port.onmessage = (e) => session.send(e.data);
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
