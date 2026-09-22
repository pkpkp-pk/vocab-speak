import { useCallback, useEffect, useRef, useState } from "react";
import { detectPitch } from "../lib/pitch.js";

// Captures the microphone and samples loudness + pitch at display rate into
// a ref array (never setState at 60 Hz). start() resolves the MediaStream so
// the caller can also attach a MediaRecorder to the same mic — one
// permission prompt, two consumers.
//
// autoGainControl is deliberately OFF: with AGC on, the OS normalizes the
// input level and the volume stats would measure the gain rider, not the
// speaker.

// Two-phase pre-session mic check: ~2s of quiet (measures the ambient noise
// floor) then ~2s of speech (confirms voiced frames, catches clipping/dead
// mics). The returned stream stays OPEN — beginSession reuses it, so the
// permission prompt happens here, once, before SpeechRecognition ever starts.
// onLevel fires at ~15 Hz for the live meter (never 60 — setState budget).
const CHECK_QUIET_S = 2;
const CHECK_SPEAK_S = 2;

export async function checkMic(onLevel = () => {}, onPhase = () => {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
  });
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  const readLevel = () => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return 20 * Math.log10(Math.max(Math.sqrt(sum / buf.length), 1e-6));
  };

  const runPhase = (phaseName, seconds, bucket) => {
    onPhase(phaseName);
    const end = performance.now() + seconds * 1000;
    let lastPush = 0;
    return new Promise((resolve) => {
      const tick = () => {
        if (performance.now() >= end) return resolve();
        const rmsDb = readLevel();
        bucket.push(rmsDb);
        const now = performance.now();
        if (now - lastPush > 66) {
          onLevel(rmsDb);
          lastPush = now;
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  };

  const quiet = [];
  const speak = [];
  await runPhase("quiet", CHECK_QUIET_S, quiet);
  await runPhase("speak", CHECK_SPEAK_S, speak);
  ctx.close().catch(() => {});
  // NOTE: stream deliberately NOT stopped — the session reuses it.

  const sortedQ = [...quiet].sort((a, b) => a - b);
  const floorDb = sortedQ.length ? sortedQ[Math.floor(sortedQ.length * 0.5)] : -60;
  const peakDb = Math.max(...speak, ...quiet, -120);
  const voicedPct = speak.filter((l) => l >= floorDb + 10).length / Math.max(speak.length, 1);
  return {
    stream,
    floorDb: +floorDb.toFixed(1),
    peakDb: +peakDb.toFixed(1),
    voicedPct: +voicedPct.toFixed(2),
  };
}

export function useAudioAnalysis() {
  const [supported] = useState(
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia
  );
  const [permissionDenied, setPermissionDenied] = useState(false);

  const streamRef = useRef(null);
  const ctxRef = useRef(null);
  const rafRef = useRef(null);
  const samplesRef = useRef([]);

  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
  }, []);

  // Safety net for unmounting mid-session (e.g. "exit session").
  useEffect(() => teardown, [teardown]);

  // startTime lets the caller share one clock with speech recognition, so
  // sample timestamps and transcript segment timestamps are comparable.
  // opts.stream: reuse an already-open stream (from checkMic) — skips the
  // second getUserMedia prompt entirely.
  const start = useCallback(async (startTime, opts = {}) => {
    if (!supported) return null;
    try {
      const stream =
        opts.stream ??
        (await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        }));
      streamRef.current = stream;

      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      // No destination connect: analysis only, nothing plays back.
      ctx.createMediaStreamSource(stream).connect(analyser);

      const buf = new Float32Array(analyser.fftSize);
      samplesRef.current = [];
      const t0 = startTime ?? performance.now();
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const rmsDb = 20 * Math.log10(Math.max(rms, 1e-6));
        // Pitch only on frames loud enough to be speech — saves CPU in silence.
        const f0 = rms > 0.008 ? detectPitch(buf, ctx.sampleRate) : null;
        samplesRef.current.push({ t: (performance.now() - t0) / 1000, rmsDb, f0 });
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
      return stream;
    } catch (err) {
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
        setPermissionDenied(true);
      }
      teardown();
      return null;
    }
  }, [supported, teardown]);

  const stop = useCallback(() => {
    const samples = samplesRef.current;
    teardown();
    return samples;
  }, [teardown]);

  return { supported, permissionDenied, start, stop };
}
