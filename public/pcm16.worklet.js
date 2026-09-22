// AudioWorklet: Float32 mic frames → 16 kHz Int16 PCM chunks (~100ms) for the
// Gemini Live stream. Served raw from public/ — worklets can't import from
// src — so the resampler below is a copy of src/lib/resample.js. Keep in sync;
// the node test suite covers the src copy.

class Pcm16Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const inputRate = options.processorOptions?.sampleRate ?? 48000;
    this.ratio = inputRate / 16000;
    this.carry = new Float32Array(0);
    this.pos = 0;
    this.out = new Int16Array(1600); // 100ms at 16 kHz
    this.outLen = 0;
  }

  emit(s) {
    const c = Math.max(-1, Math.min(1, s));
    this.out[this.outLen++] = c < 0 ? c * 0x8000 : c * 0x7fff;
    if (this.outLen === this.out.length) {
      this.port.postMessage(this.out.slice());
      this.outLen = 0;
    }
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    const buf = new Float32Array(this.carry.length + input.length);
    buf.set(this.carry);
    buf.set(input, this.carry.length);
    while (this.pos < buf.length) {
      const i0 = Math.floor(this.pos);
      const i1 = Math.min(Math.floor(this.pos + this.ratio), buf.length);
      let sum = 0;
      for (let k = i0; k < i1; k++) sum += buf[k];
      this.emit(sum / Math.max(1, i1 - i0));
      this.pos += this.ratio;
    }
    const used = Math.floor(this.pos - this.ratio) + 1;
    this.carry = buf.slice(used);
    this.pos -= used;
    return true;
  }
}

registerProcessor("pcm16", Pcm16Processor);
