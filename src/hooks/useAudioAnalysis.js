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
  const start = useCallback(async (startTime) => {
    if (!supported) return null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
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
