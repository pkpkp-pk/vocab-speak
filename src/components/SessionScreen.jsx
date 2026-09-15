import { useEffect, useRef, useState } from "react";
import TimerRing from "./TimerRing.jsx";
import KeywordHelper, { REVEAL_BATCH } from "./KeywordHelper.jsx";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition.js";
import "./SessionScreen.css";

export default function SessionScreen({ topic, targetSeconds, onFinish, onExit }) {
  const [elapsed, setElapsed] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef(null);
  const startedAtRef = useRef(null);

  const speech = useSpeechRecognition();

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

  const beginSession = () => {
    setRunning(true);
    if (speech.supported) speech.start();
  };

  const endSession = () => {
    setRunning(false);
    clearInterval(intervalRef.current);
    if (speech.supported) speech.stop();
    onFinish({
      transcript: speech.fullTranscript,
      durationSeconds: elapsed,
      keywordsRevealed: revealedCount,
    });
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
