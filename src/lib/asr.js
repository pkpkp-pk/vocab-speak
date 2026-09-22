// Main-thread wrapper around asr.worker.js: one lazily-created worker (the
// ~63 MB model stays loaded for repeat transcriptions), promise API, progress
// passthrough. Mirrors pronunciation.js.

let worker = null;

function getWorker() {
  worker ??= new Worker(new URL("./asr.worker.js", import.meta.url), {
    type: "module",
  });
  return worker;
}

// audio: Float32Array 16 kHz mono; chunks: [{ start, end }] from asrChunks.js.
export function transcribeOnDevice({ audio, chunks }, onProgress) {
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
    w.postMessage({ type: "transcribe", audio: copy, chunks }, [copy.buffer]);
  });
}
