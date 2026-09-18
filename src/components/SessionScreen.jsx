import { useEffect, useRef, useState } from "react";
import TimerRing from "./TimerRing.jsx";
import KeywordHelper, { REVEAL_BATCH } from "./KeywordHelper.jsx";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition.js";
import { useAudioAnalysis } from "../hooks/useAudioAnalysis.js";
import "./SessionScreen.css";

// Human-readable copy for SpeechRecognition error codes.
function friendlySpeechError(code) {
  switch (code) {
    case "not-allowed":
      return "Microphone access is blocked — allow it via the address-bar icon, then retry.";
    case "audio-capture":
      return "No microphone signal — check your input device.";
    case "service-not-allowed":
    case "network":
      return "Chrome's speech service is unreachable — check your connection.";
    default:
      return `Transcription error: ${code}.`;
  }
}

export default function SessionScreen({ topic, targetSeconds, onFinish, onExit }) {
  const [elapsed, setElapsed] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef(null);
  const startedAtRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  const speech = useSpeechRecognition();
  const audio = useAudioAnalysis();

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

  // If the user exits mid-session, drop the recorder without emitting a blob.
  useEffect(
    () => () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
    },
    []
  );

  const beginSession = async () => {
    setRunning(true);
    // One shared clock for speech segments and audio samples — the waveform
    // alignment on the results screen depends on both using the same t0.
    const t0 = performance.now();

    // Acquire the mic FIRST: a single getUserMedia prompt settles the
    // permission, then SpeechRecognition starts cleanly. (Starting both at
    // once races the two requests and recognition can fail with
    // "not-allowed"/"audio-capture" while the prompt is still open.)
    const stream = await audio.start(t0);
    if (speech.supported) speech.start(t0);
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
    if (speech.supported) speech.stop();

    // Timestamped final segments for waveform alignment. If the user finishes
    // mid-thought, the trailing interim text isn't in any segment yet — append
    // it so the annotated transcript covers everything that was said.
    const speechSegments = speech.supported ? speech.getSegments().slice() : [];
    const joined = speechSegments.map((s) => s.text).join(" ").trim();
    const full = speech.fullTranscript;
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
        // "um"/"uh" Chrome stripped from finals, recovered from interims.
        strippedFillers: speech.supported ? { ...speech.getStrippedFillers() } : {},
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
        <button onClick={beginSession} className="btn-primary session-start">
          {speech.supported ? "🎙️ Start talking" : "▶ Start timer"}
        </button>
      ) : (
        <div className="session-running">
          {speech.supported && (
            <div className="transcript-live">
              <span className="transcript-final">{speech.finalTranscript}</span>
              <span className="transcript-interim">{speech.interimTranscript}</span>
              {!speech.error && !speech.finalTranscript && !speech.interimTranscript && (
                <span className="transcript-waiting">listening…</span>
              )}
            </div>
          )}

          {speech.error && (
            <p className="session-error">
              {friendlySpeechError(speech.error)}{" "}
              <button className="session-error-retry" onClick={() => speech.start()}>
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

      {!speech.supported && (
        <p className="session-note">
          Your browser doesn't support live transcription — try Chrome or Edge for that feature.
          The timer and keyword prompts still work fine here.
        </p>
      )}

      <button onClick={onExit} className="session-exit">
        exit session
      </button>
    </div>
  );
}
