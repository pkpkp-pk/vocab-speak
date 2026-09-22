import { useState } from "react";
import { decodeToMono16k, MAX_ANALYZED_SECONDS } from "../lib/decodeAudio.js";
import { analyzeWithGemini } from "../lib/aiCoach.js";
import "./CoachPanel.css";

// Opt-in AI coach: sends the session recording to Gemini with the user's own
// key. Sits next to the on-device pronunciation analysis — that one is free
// and private, this one is smarter but uploads audio.
export default function CoachPanel({ audioBlob, topic, transcript, stats, geminiKey, onOpenSettings }) {
  const [state, setState] = useState("idle"); // idle | busy | error | done
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = async () => {
    setState("busy");
    setError(null);
    try {
      const pcm = await decodeToMono16k(audioBlob);
      const res = await analyzeWithGemini({ apiKey: geminiKey, pcm, topic, transcript, stats });
      setResult(res);
      setState("done");
    } catch (err) {
      setError(err.message);
      setState("error");
    }
  };

  const fillerEntries = Object.entries(result?.fillersHeard ?? {}).filter(([, n]) => n > 0);

  return (
    <div className="card card-dim coach-panel">
      <p className="label-xs filler-label">ai coach</p>

      {state === "idle" && !geminiKey && (
        <>
          <p className="coach-note">
            Feedback no local metric can give — fillers heard by ear, pronunciation,
            grammar, vocabulary upgrades — by sending your recording (first{" "}
            {MAX_ANALYZED_SECONDS}s) to Google's Gemini API. Needs your own free AI
            Studio key.
          </p>
          <button onClick={onOpenSettings} className="btn-ghost coach-run">
            Add a Gemini key in settings
          </button>
        </>
      )}

      {state === "idle" && geminiKey && (
        <>
          <p className="coach-note">
            Sends your recording (first {MAX_ANALYZED_SECONDS}s) to Google's Gemini API
            with your key. Nothing is sent until you click.
          </p>
          <button onClick={run} className="btn-ghost coach-run">
            🤖 Get AI coach feedback
          </button>
        </>
      )}

      {state === "busy" && (
        <>
          <p className="coach-note">listening to your recording…</p>
          <div className="coach-bar-track">
            <div className="coach-bar-fill" />
          </div>
          <p className="coach-hint">usually takes 5–15 seconds</p>
        </>
      )}

      {state === "error" && (
        <>
          <p className="coach-note">Coach failed: {error}</p>
          <button onClick={run} className="btn-ghost coach-run">
            ↻ Retry
          </button>
        </>
      )}

      {state === "done" && result && (
        <>
          <div className="coach-head">
            {result.fluencyScore != null && (
              <span className="coach-score">
                {result.fluencyScore}
                <span className="coach-score-max">/10</span>
              </span>
            )}
            {result.summary && <p className="coach-summary">{result.summary}</p>}
          </div>

          {fillerEntries.length > 0 && (
            <div className="coach-section">
              <p className="coach-heading">fillers heard by ear</p>
              <div className="filler-chips">
                {fillerEntries.map(([word, n]) => (
                  <span key={word} className="chip">
                    "{word}" ×{n}
                  </span>
                ))}
              </div>
            </div>
          )}

          {result.pronunciation.length > 0 && (
            <div className="coach-section">
              <p className="coach-heading">pronunciation</p>
              <ul className="coach-list">
                {result.pronunciation.map((p, i) => (
                  <li key={i}>
                    <strong>"{p.word}"</strong> — {p.tip}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.grammar.length > 0 && (
            <div className="coach-section">
              <p className="coach-heading">grammar</p>
              <ul className="coach-list">
                {result.grammar.map((g, i) => (
                  <li key={i}>
                    <span className="coach-said">"{g.said}"</span> →{" "}
                    <span className="coach-better">"{g.better}"</span>
                    {g.why ? <span className="coach-why"> ({g.why})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.vocabulary.length > 0 && (
            <div className="coach-section">
              <p className="coach-heading">vocabulary upgrades</p>
              <ul className="coach-list">
                {result.vocabulary.map((v, i) => (
                  <li key={i}>
                    <span className="coach-said">{v.insteadOf}</span> →{" "}
                    <span className="coach-better">{v.try}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
