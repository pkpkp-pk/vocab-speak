import { useEffect, useState } from "react";
import { decodeToMono16k } from "../lib/decodeAudio.js";
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

// Auto-runs on mount and renders NOTHING while the model downloads and the
// analysis runs (the model was prewarmed when the session started, so on a
// warm cache this lands quickly). The panel only appears with its scores;
// on failure it shrinks to a one-line note with a retry.
export default function PronunciationPanel({ audioBlob, transcript, onWordSpans }) {
  const [result, setResult] = useState(null);
  const [failed, setFailed] = useState(false);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pcm = await decodeToMono16k(audioBlob);
        const res = await analyzePronunciation({ audio: pcm, transcript });
        if (cancelled) return;
        setResult(res);
        setFailed(false);
        // Measured per-word timings upgrade the transcript heatmap in place.
        if (res.words?.some((w) => w.start != null)) onWordSpans?.(res.words);
      } catch (err) {
        console.warn("pronunciation analysis failed:", err);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audioBlob, transcript, runId, onWordSpans]);

  if (!result && !failed) return null;

  const weak = result?.words.filter((w) => w.score < OK_SCORE) ?? [];

  return (
    <div className="card card-dim pron-panel">
      <p className="label-xs filler-label">pronunciation</p>

      {failed && (
        <>
          <p className="pron-note">Pronunciation analysis unavailable.</p>
          <button onClick={() => setRunId((n) => n + 1)} className="btn-ghost pron-run">
            ↻ Retry
          </button>
        </>
      )}

      {result && (
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
