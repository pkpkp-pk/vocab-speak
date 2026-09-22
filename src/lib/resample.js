// Streaming resampler to 16 kHz for the Gemini Live PCM feed. Boxcar-average
// over each input window (cheap anti-alias) — good enough for ASR.
// Keep public/pcm16.worklet.js in sync with this file (worklets are served
// raw from public/ and cannot import from src).

export function createResampler(inputRate, outputRate = 16000) {
  if (inputRate === outputRate) return { push: (chunk) => chunk };
  const ratio = inputRate / outputRate;
  let carry = new Float32Array(0);
  let pos = 0; // next output sample's read position within carry+chunk

  return {
    push(chunk) {
      const buf = new Float32Array(carry.length + chunk.length);
      buf.set(carry);
      buf.set(chunk, carry.length);
      const out = [];
      while (pos < buf.length) {
        const i0 = Math.floor(pos);
        const i1 = Math.min(Math.floor(pos + ratio), buf.length);
        let sum = 0;
        for (let k = i0; k < i1; k++) sum += buf[k];
        out.push(sum / Math.max(1, i1 - i0));
        pos += ratio;
      }
      const used = Math.floor(pos - ratio) + 1;
      carry = buf.slice(used);
      pos -= used;
      return Float32Array.from(out);
    },
  };
}
