import { useEffect, useRef, useState } from "react";
import { decodeToMono16k, MAX_ANALYZED_SECONDS } from "../lib/decodeAudio.js";
import { analyzePronunciation } from "../lib/pronunciation.js";
import "./PronunciationPanel.css";

// Scores are CTC posteriors against the reference transcript: how confidently
// the acoustic model heard each word's letters in the audio.
const CLEAR_SCORE = 0.7;
const OK_SCORE = 0.45;

function wordClass(score) {
  if (score >= CLEAR_SCORE) return "word-good";
  if (score >= OK_SCORE) return "word-ok";
  return "word-weak";
}

function progressLabel(p) {
  if (p.stage === "download") return `downloading model… ${Math.round(p.progress * 100)}%`;
  if (p.stage === "inference")
    return `analyzing audio… ${Math.round(p.progress * 100)}%`;
  return "preparing…";
}

export default function PronunciationPanel({ audioBlob, transcript, onWordSpans }) {
  const [state, setState] = useState("idle"); // idle | busy | done | error
  const [progress, setProgress] = useState({ stage: "load", progress: 0 });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = async () => {
    setState("busy");
    setError(null);
    setProgress({ stage: "load", progress: 0 });
    try {
      const pcm = await decodeToMono16k(audioBlob);
      const res = await analyzePronunciation(
        { audio: pcm, transcript },
        (p) => setProgress(p)
      );
      setResult(res);
      setState("done");
      // Measured per-word timings upgrade the transcript heatmap in place.
      if (res.words?.some((w) => w.start != null)) onWordSpans?.(res.words);
    } catch (err) {
      setError(err.message);
      setState("error");
    }
  };

  const weak = result?.words.filter((w) => w.score < OK_SCORE) ?? [];

  // Deep analysis is default-on: run as soon as the panel mounts. The ref
  // guard absorbs StrictMode's dev double-effect; the worker wrapper dedupes
  // a second in-flight call regardless.
  const didAutoRun = useRef(false);
  useEffect(() => {
    if (didAutoRun.current) return;
    didAutoRun.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card card-dim pron-panel">
      <p className="label-xs filler-label">pronunciation</p>

      {state === "idle" && (
        <>
          <p className="pron-note">
            Score each word with a speech model running entirely on your device.
            First run downloads ~95&nbsp;MB (cached afterwards); only the first{" "}
            {MAX_ANALYZED_SECONDS}s are analyzed.
            {typeof caches === "undefined" && (
              <>
                {" "}
                ⚠ This origin can't cache (needs localhost or HTTPS) — the model will
                re-download on every visit.
              </>
            )}
          </p>
          <button onClick={run} className="btn-ghost pron-run">
            🔬 Analyze my pronunciation
          </button>
        </>
      )}

      {state === "busy" && (
        <>
          <p className="pron-note">{progressLabel(progress)}</p>
          <div className="pron-bar-track">
            <div
              className="pron-bar-fill"
              style={{ width: `${Math.round((progress.progress || 0.02) * 100)}%` }}
            />
          </div>
          <p className="pron-hint">you can keep reading your other stats — this runs in the background</p>
        </>
      )}

      {state === "error" && (
        <>
          <p className="pron-note">Couldn't run the analysis: {error}</p>
          <button onClick={run} className="btn-ghost pron-run">
            ↻ Retry
          </button>
        </>
      )}

      {state === "done" && result && (
        <>
          {result.decodedTranscript && (
            <p className="pron-note">
              No live transcript available — scored against the on-device model's own
              transcription, so treat scores as a rough guide.
            </p>
          )}
          {result.truncated && (
            <p className="pron-note">Audio was long — only the words that fit were scored.</p>
          )}
          {result.words.length > 0 ? (
            <>
              <div className="pron-words">
                {result.words.map((w, i) => (
                  <span key={`${w.word}-${i}`} className={`chip pron-word ${wordClass(w.score)}`}>
                    {w.word}
                  </span>
                ))}
              </div>
              <p className="pron-legend">
                <span className="pron-legend-good">clear</span> ·{" "}
                <span className="pron-legend-ok">ok</span> ·{" "}
                <span className="pron-legend-weak">worth practicing</span>
              </p>
              {weak.length > 0 && (
                <p className="pron-weak-list">
                  practice: {weak.slice(0, 6).map((w) => `"${w.word}"`).join(", ")}
                </p>
              )}
            </>
          ) : (
            <p className="pron-note">No scoreable words found in this recording.</p>
          )}
        </>
      )}
    </div>
  );
}
