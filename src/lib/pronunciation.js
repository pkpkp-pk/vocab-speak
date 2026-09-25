// Main-thread wrapper around pronunciation.worker.js: one lazily-created
// worker (the ~95 MB model stays loaded for repeat analyses), promise API,
// progress passthrough.

let worker = null;
let inFlight = null; // StrictMode dev double-mount fires the auto-run twice

function getWorker() {
  worker ??= new Worker(new URL("./pronunciation.worker.js", import.meta.url), {
    type: "module",
  });
  return worker;
}

// Kick off the model download/load early (called when a session starts) so
// the analysis at session end doesn't wait on ~95 MB of cold network.
export function prewarmPronunciation() {
  getWorker().postMessage({ type: "prewarm" });
}

export function analyzePronunciation({ audio, transcript }, onProgress) {
  inFlight ??= new Promise((resolve, reject) => {
    const w = getWorker();
    const onMessage = (e) => {
      const m = e.data;
      if (m.type === "progress") {
        onProgress?.(m);
      } else if (m.type === "done") {
        w.removeEventListener("message", onMessage);
        resolve(m);
      } else if (m.type === "error") {
        w.removeEventListener("message", onMessage);
        reject(new Error(m.message));
      }
    };
    w.addEventListener("message", onMessage);

    // Copy so the caller's buffer survives the transfer.
    const copy = audio.slice();
    w.postMessage({ type: "analyze", audio: copy, transcript }, [copy.buffer]);
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
