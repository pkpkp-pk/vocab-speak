import { useEffect, useRef, useState } from "react";
import TimerRing from "./TimerRing.jsx";
import KeywordHelper, { REVEAL_BATCH } from "./KeywordHelper.jsx";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition.js";
import { useGeminiLive } from "../hooks/useGeminiLive.js";
import { useAudioAnalysis, checkMic } from "../hooks/useAudioAnalysis.js";
import "./SessionScreen.css";

// Verdict from the pre-session mic check numbers.
function micVerdict({ floorDb, peakDb, voicedPct }) {
  if (voicedPct < 0.05 && floorDb < -70) {
    return "No voice detected — check that the right input device is selected and unmuted.";
  }
  if (peakDb > -1) {
    return "Signal is clipping — move a little further from the mic or lower the input gain.";
  }
  if (floorDb > -35) {
    return `Noisy room (floor ${floorDb} dB) — analysis will use your measured noise floor, but quieter is better.`;
  }
  return `Mic sounds good (noise floor ${floorDb} dB).`;
}

// Human-readable copy for transcription engine errors. Format: "code" or
// "code|detail" (detail = WS close code/reason or diagnostics).
function friendlySpeechError(raw) {
  const [code, detail] = String(raw).split("|");
  const suffix = detail ? ` (${detail})` : "";
  switch (code) {
    case "not-allowed":
      return "Microphone access is blocked — allow it via the address-bar icon, then retry.";
    case "audio-capture":
      return "No microphone signal — check your input device.";
    case "service-not-allowed":
    case "network":
      return "Chrome's speech service is unreachable — check your connection.";
    case "connection-error":
      return `Couldn't reach Gemini — check the key in settings and your connection.${suffix}`;
    case "connection-lost":
      return `Gemini live connection dropped — retry.${suffix}`;
    case "no-setup":
      return `Gemini rejected the live session${suffix} — the key may lack Transcribe Live access. Turn off Gemini transcription in settings to use Chrome.`;
    case "no-text":
      return `Gemini connected but sent no transcript in 10s${suffix}. Turn off Gemini transcription in settings to use Chrome.`;
    default:
      return `Transcription error: ${code}.`;
  }
}

export default function SessionScreen({ topic, targetSeconds, onFinish, onExit, geminiKey }) {
  const [elapsed, setElapsed] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);
  const [running, setRunning] = useState(false);
  // Mic check: null | {phase: "quiet"|"speak"} | {done, floorDb, peakDb, voicedPct} | {done, error}
  const [micCheck, setMicCheck] = useState(null);
  const [micLevel, setMicLevel] = useState(-60);
  const intervalRef = useRef(null);
  const startedAtRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const calibStreamRef = useRef(null);
  const micFloorRef = useRef(null);

  const speech = useSpeechRecognition();
  const geminiLive = useGeminiLive(geminiKey);
  // Gemini Live when a key exists (hears fillers, better accents), else Chrome.
  const engine = geminiLive.supported ? geminiLive : speech;
  const audio = useAudioAnalysis();
  const t0Ref = useRef(0);
  const streamRef = useRef(null);

  useEffect(() => {
    if (running) {
      startedAtRef.current = Date.now() - elapsed * 1000;
      intervalRef.current = setInterval(() => {
        setElapsed((Date.now() - startedAtRef.current) / 1000);
      }, 200);
    }
    return () => clearInterval(intervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // If the user exits mid-session, drop the recorder without emitting a blob;
  // also stop a leftover mic-check stream if they never started a session.
  useEffect(
    () => () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      calibStreamRef.current?.getTracks().forEach((t) => t.stop());
    },
    []
  );

  const runMicCheck = async () => {
    if (micCheck && !micCheck.done) return; // already running
    // A re-check replaces the old stream.
    calibStreamRef.current?.getTracks().forEach((t) => t.stop());
    calibStreamRef.current = null;
    micFloorRef.current = null;
    try {
      setMicCheck({ phase: "quiet" });
      const res = await checkMic(
        (db) => setMicLevel(db),
        (phase) => setMicCheck({ phase })
      );
      calibStreamRef.current = res.stream;
      micFloorRef.current = res.floorDb;
      setMicCheck({ done: true, ...res });
    } catch {
      setMicCheck({ done: true, error: true });
    }
  };

  const beginSession = async () => {
    setRunning(true);
    // One shared clock for speech segments and audio samples — the waveform
    // alignment on the results screen depends on both using the same t0.
    const t0 = performance.now();

    // Acquire the mic FIRST: a single getUserMedia prompt settles the
    // permission, then the transcription engine starts cleanly. (Starting both
    // at once races the two requests and recognition can fail with
    // "not-allowed"/"audio-capture" while the prompt is still open.)
    // If the mic check already opened a stream, reuse it — no prompt at all.
    const stream = await audio.start(t0, { stream: calibStreamRef.current ?? undefined });
    calibStreamRef.current = null; // the hook owns it now (stopped at stop())
    t0Ref.current = t0;
    streamRef.current = stream; // kept for the error-retry path
    if (engine.supported) engine.start(t0, stream);
    if (stream && typeof MediaRecorder !== "undefined") {
      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "";
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      rec.ondataavailable = (e) => {
        if (e.data?.size) chunksRef.current.push(e.data);
      };
      rec.start(1000);
      recorderRef.current = rec;
    }
  };

  const endSession = () => {
    setRunning(false);
    clearInterval(intervalRef.current);
    if (engine.supported) engine.stop();
    streamRef.current = null;

    // Timestamped final segments for waveform alignment. If the user finishes
    // mid-thought, the trailing interim text isn't in any segment yet — append
    // it so the annotated transcript covers everything that was said.
    const speechSegments = engine.supported ? engine.getSegments().slice() : [];
    const joined = speechSegments.map((s) => s.text).join(" ").trim();
    const full = engine.fullTranscript;
    const leftover = full.length > joined.length ? full.slice(joined.length).trim() : "";
    if (leftover) speechSegments.push({ text: leftover, endedAt: elapsed });

    const finish = (audioBlob) =>
      onFinish({
        transcript: full,
        durationSeconds: elapsed,
        keywordsRevealed: revealedCount,
        audioSamples: audio.stop(),
        audioBlob,
        speechSegments,
        // "um"/"uh" Chrome stripped from finals, recovered from interims
        // (always empty under Gemini Live — that transcript keeps fillers).
        strippedFillers: engine.supported ? { ...engine.getStrippedFillers() } : {},
        // Measured noise floor from the mic check (null = adaptive fallback).
        micFloorDb: micFloorRef.current,
      });

    // Let MediaRecorder flush its final chunk before finishing.
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = () =>
        finish(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
      rec.stop();
      recorderRef.current = null;
    } else {
      finish(null);
    }
  };

  const revealKeywords = () => setRevealedCount((c) => Math.min(c + REVEAL_BATCH, topic.keywords.length));

  return (
    <div className="session-screen">
      <div className="session-head">
        <p className="label-xs">your topic</p>
        <h2 className="session-title">{topic.title}</h2>
        <p className="session-prompt">{topic.prompt}</p>
      </div>

      <TimerRing elapsedSeconds={elapsed} targetSeconds={targetSeconds} listening={running} />

      {!running ? (
        <>
          <button onClick={beginSession} className="btn-primary session-start">
            {engine.supported ? "🎙️ Start talking" : "▶ Start timer"}
          </button>

          {audio.supported && (
            <div className="mic-check">
              {!micCheck && (
                <button onClick={runMicCheck} className="btn-ghost mic-check-btn">
                  check mic first
                </button>
              )}
              {micCheck && !micCheck.done && (
                <>
                  <div className="mic-meter-track">
                    <div
                      className="mic-meter-fill"
                      style={{
                        width: `${Math.max(0, Math.min(100, ((micLevel + 60) / 55) * 100))}%`,
                      }}
                    />
                  </div>
                  <p className="mic-check-note">
                    {micCheck.phase === "quiet"
                      ? "stay quiet… measuring room noise"
                      : "now say something"}
                  </p>
                </>
              )}
              {micCheck?.done && !micCheck.error && (
                <>
                  <p className="mic-check-note">{micVerdict(micCheck)}</p>
                  <button onClick={runMicCheck} className="btn-ghost mic-check-btn">
                    re-check
                  </button>
                </>
              )}
              {micCheck?.error && (
                <p className="mic-check-note">
                  Mic blocked — allow access via the address-bar icon, or just start and the
                  browser will ask.
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="session-running">
          {engine.supported && (
            <div className="transcript-live">
              <span className="transcript-final">{engine.finalTranscript}</span>
              <span className="transcript-interim">{engine.interimTranscript}</span>
              {!engine.error && !engine.finalTranscript && !engine.interimTranscript && (
                <span className="transcript-waiting">listening…</span>
              )}
              <span className="engine-badge">
                {geminiLive.supported ? "Gemini live" : "Chrome"} transcription
              </span>
            </div>
          )}

          {engine.error && (
            <p className="session-error">
              {friendlySpeechError(engine.error)}{" "}
              <button
                className="session-error-retry"
                onClick={() => engine.start(t0Ref.current, streamRef.current)}
              >
                retry
              </button>
            </p>
          )}

          <KeywordHelper keywords={topic.keywords} revealedCount={revealedCount} onReveal={revealKeywords} />

          <button onClick={endSession} className="btn-ghost session-finish">
            ■ Finish & see stats
          </button>
        </div>
      )}

      {!engine.supported && (
        <p className="session-note">
          Your browser doesn't support live transcription — try Chrome or Edge, or add a
          Gemini key (gear icon) to transcribe anywhere. The timer and keyword prompts still
          work fine here.
        </p>
      )}

      <button onClick={onExit} className="session-exit">
        exit session
      </button>
    </div>
  );
}
