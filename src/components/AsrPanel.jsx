import { useState } from "react";
import { decodeToMono16k } from "../lib/decodeAudio.js";
import { planChunks } from "../lib/asrChunks.js";
import { transcribeOnDevice } from "../lib/asr.js";
import { analyzeSpeech } from "../lib/analyzeSpeech.js";
import "./AsrPanel.css";

// The browser Cache API (transformers.js's model cache) only exists in
// secure contexts — on a plain-HTTP LAN origin the model re-downloads every
// visit, so warn before the user clicks.
const CAN_CACHE = typeof caches !== "undefined";

// Post-session on-device re-transcription (Moonshine). Chrome's recognizer
// strips "um"/"uh" and doesn't exist outside Chrome — this worker hears the
// audio directly, so fillers survive and Firefox/Safari get a transcript at
// all. The result can replace the Chrome transcript wholesale via onApply.
export default function AsrPanel({ audioBlob, audioSamples, micFloorDb, chromeFillerTotal, onApply }) {
  const [state, setState] = useState("idle"); // idle | busy | error | done | applied
  const [progress, setProgress] = useState({ stage: "load", progress: 0 });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = async () => {
    setState("busy");
    setError(null);
    setProgress({ stage: "load", progress: 0 });
    try {
      const pcm = await decodeToMono16k(audioBlob, 600); // full session, not 90s
      const chunks = planChunks(audioSamples, { floorDb: micFloorDb });
      if (!chunks.length) throw new Error("No speech found in the recording");
      const res = await transcribeOnDevice({ audio: pcm, chunks }, setProgress);
      if (!res.text?.trim()) throw new Error("The model heard only silence");
      setResult(res);
      setState("done");
    } catch (err) {
      setError(err.message);
      setState("error");
    }
  };

  const onDeviceFillers = result
    ? analyzeSpeech(result.text, { durationSeconds: 60 }).fillerTotal
    : 0;

  return (
    <div className="card card-dim asr-panel">
      <p className="label-xs filler-label">on-device transcript</p>

      {state === "idle" && (
        <>
          <p className="asr-note">
            Re-transcribe this session with a model running on your device — it hears
            "um"/"uh" that Chrome's transcript drops, and works offline. First run
            downloads ~63&nbsp;MB (cached afterwards); audio never leaves the browser.
            {!CAN_CACHE && (
              <>
                {" "}
                ⚠ This origin can't cache (needs localhost or HTTPS) — the model will
                re-download on every visit.
              </>
            )}
          </p>
          <button onClick={run} className="btn-ghost asr-run">
            📝 Re-transcribe on-device
          </button>
        </>
      )}

      {state === "busy" && (
        <>
          <p className="asr-note">
            {progress.stage === "download"
              ? `downloading model… ${Math.round(progress.progress * 100)}%`
              : `transcribing… ${Math.round(progress.progress * 100)}%`}
          </p>
          <div className="asr-bar-track">
            <div
              className="asr-bar-fill"
              style={{ width: `${Math.round((progress.progress || 0.02) * 100)}%` }}
            />
          </div>
          <p className="asr-hint">runs in the background — a 3-minute session takes ~30–90s</p>
        </>
      )}

      {state === "error" && (
        <>
          <p className="asr-note">Couldn't transcribe: {error}</p>
          <button onClick={run} className="btn-ghost asr-run">
            ↻ Retry
          </button>
        </>
      )}

      {state === "done" && result && (
        <>
          <p className="asr-preview">"{result.text}"</p>
          <p className="asr-note">
            heard {onDeviceFillers} filler{onDeviceFillers === 1 ? "" : "s"} · Chrome kept{" "}
            {chromeFillerTotal}
          </p>
          <button
            onClick={() => {
              onApply(result.text, result.segments);
              setState("applied");
            }}
            className="btn-amber asr-run"
          >
            Use this transcript for my stats
          </button>
        </>
      )}

      {state === "applied" && (
        <p className="asr-note">On-device transcript applied — stats and heatmap updated.</p>
      )}
    </div>
  );
}
