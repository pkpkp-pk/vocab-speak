import { useEffect, useRef, useState } from "react";
import TimerRing from "./TimerRing.jsx";
import KeywordHelper, { REVEAL_BATCH } from "./KeywordHelper.jsx";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition.js";
import { useAudioAnalysis } from "../hooks/useAudioAnalysis.js";
import "./SessionScreen.css";

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
    if (speech.supported) speech.start();

    // Audio analysis + recording share one mic stream (one permission prompt).
    const stream = await audio.start();
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

    const finish = (audioBlob) =>
      onFinish({
        transcript: speech.fullTranscript,
        durationSeconds: elapsed,
        keywordsRevealed: revealedCount,
        audioSamples: audio.stop(),
        audioBlob,
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
              {!speech.finalTranscript && !speech.interimTranscript && (
                <span className="transcript-waiting">listening…</span>
              )}
            </div>
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
