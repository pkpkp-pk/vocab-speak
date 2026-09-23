// YIN-lite pitch detection: decimate the frame, then the classic YIN steps —
// difference function, cumulative-mean normalization, first-dip thresholding,
// parabolic interpolation. Pure function, no dependencies.
//
// Returns estimated fundamental frequency in Hz, or null when the frame
// looks unvoiced/too noisy.

const MIN_HZ = 50; // below typical vocal range
const MAX_HZ = 400; // above typical speaking range
const YIN_THRESHOLD = 0.15;
const RMS_GATE = 0.008; // below this the frame is silence/unvoiced

export function detectPitch(samples, sampleRate) {
  // Decimate to ~12 kHz: pitch up to 400 Hz stays far below Nyquist, and the
  // difference function gets ~16x cheaper than running on the raw 48 kHz frame.
  const step = Math.max(1, Math.round(sampleRate / 12000));
  const rate = sampleRate / step;
  const n = Math.floor(samples.length / step);
  if (n < 64) return null;

  const buf = new Float32Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i * step];
    buf[i] = v;
    energy += v * v;
  }
  if (Math.sqrt(energy / n) < RMS_GATE) return null;

  const minLag = Math.max(2, Math.floor(rate / MAX_HZ));
  const maxLag = Math.min(Math.floor(rate / MIN_HZ), n - 2);
  if (maxLag <= minLag) return null;

  // Difference function d(tau) over a fixed window.
  const window = n - maxLag;
  const d = new Float32Array(maxLag + 1);
  for (let tau = minLag; tau <= maxLag; tau++) {
    let sum = 0;
    for (let j = 0; j < window; j++) {
      const diff = buf[j] - buf[j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // Cumulative mean normalized difference — robust to amplitude changes.
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  // First dip below threshold, then walk to its local minimum.
  let tau = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (cmnd[t] < YIN_THRESHOLD) {
      while (t + 1 <= maxLag && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) return null;

  // Parabolic interpolation around the minimum for sub-sample accuracy.
  let betterTau = tau;
  if (tau > minLag && tau < maxLag) {
    const s0 = cmnd[tau - 1];
    const s1 = cmnd[tau];
    const s2 = cmnd[tau + 1];
    const denom = s0 - 2 * s1 + s2;
    if (Math.abs(denom) > 1e-9) betterTau = tau + (s0 - s2) / (2 * denom);
  }

  const hz = rate / betterTau;
  return hz >= MIN_HZ && hz <= MAX_HZ ? hz : null;
}
