// Main-thread wrapper around pronunciation.worker.js: one lazily-created
// worker (the ~95 MB model stays loaded for repeat analyses), promise API,
// progress passthrough.

let worker = null;

function getWorker() {
  worker ??= new Worker(new URL("./pronunciation.worker.js", import.meta.url), {
    type: "module",
  });
  return worker;
}

export function analyzePronunciation({ audio, transcript }, onProgress) {
  return new Promise((resolve, reject) => {
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
  });
}
