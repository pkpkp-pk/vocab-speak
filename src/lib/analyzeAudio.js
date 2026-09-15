// Pure statistics over the raw audio samples collected during a session.
// samples: [{ t: seconds since start, rmsDb: dBFS level, f0: Hz | null }]
//
// Everything here is derived from the waveform itself — no transcript and
// no network involved — so these metrics work in every modern browser,
// including ones without SpeechRecognition.

const PAUSE_MIN_S = 0.3; // shorter gaps are just normal articulation
const FLOOR_MARGIN_DB = 10; // voiced = at least this far above the noise floor
const MIN_VOICED_S = 2; // less speech than this → too little data to judge
const MIN_PITCH_FRAMES = 30; // ~0.5s of voiced pitch before judging monotone
const SPARK_BUCKETS = 120;

// Verdict thresholds (dBFS, voiced frames only; heuristic by nature since
// absolute levels depend on the mic — autoGainControl is disabled at capture
// so these reflect the speaker, not the OS's gain riding).
const QUIET_DB = -40;
const LOUD_DB = -12;
const STEADY_VOLUME_STDEV_DB = 8;

// Pitch variation, in semitones around the speaker's own median F0.
const MONOTONE_ST = 1.5;
const EXPRESSIVE_ST = 3;

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export function analyzeAudio(samples) {
  if (!samples || samples.length < 20) return null;

  const levels = samples.map((s) => s.rmsDb);
  const sortedLevels = [...levels].sort((a, b) => a - b);
  const floor = percentile(sortedLevels, 0.1);
  const threshold = Math.max(floor + FLOOR_MARGIN_DB, -55);
  const voiced = levels.map((l) => l >= threshold);

  // Clip analysis to the region actually containing speech.
  let first = voiced.indexOf(true);
  let last = voiced.lastIndexOf(true);
  if (first === -1) return null;
  const clip = samples.slice(first, last + 1);
  const clipVoiced = voiced.slice(first, last + 1);

  let voicedSeconds = 0;
  for (let i = 1; i < clip.length; i++) {
    if (clipVoiced[i]) voicedSeconds += clip[i].t - clip[i - 1].t;
  }
  if (voicedSeconds < MIN_VOICED_S) return null;

  const spanSeconds = clip[clip.length - 1].t - clip[0].t || voicedSeconds;

  // Pauses: unvoiced runs of >= PAUSE_MIN_S bounded by speech on both sides.
  const pauses = [];
  let runStart = null;
  for (let i = 0; i < clip.length; i++) {
    if (!clipVoiced[i] && runStart === null) runStart = clip[i].t;
    if (clipVoiced[i] && runStart !== null) {
      const dur = clip[i].t - runStart;
      // store position relative to the start of speech (for the sparkline)
      if (dur >= PAUSE_MIN_S) pauses.push({ t: runStart - clip[0].t, dur });
      runStart = null;
    }
  }
  const pauseTotal = pauses.reduce((a, p) => a + p.dur, 0);
  const longestPause = pauses.reduce((a, p) => Math.max(a, p.dur), 0);
  const pausesPerMin = spanSeconds > 0 ? (pauses.length / spanSeconds) * 60 : 0;

  // Volume over voiced frames.
  const voicedDb = clip.filter((_, i) => clipVoiced[i]).map((s) => s.rmsDb);
  const meanDb = voicedDb.reduce((a, b) => a + b, 0) / voicedDb.length;
  const volumeStdev = Math.sqrt(
    voicedDb.reduce((a, b) => a + (b - meanDb) ** 2, 0) / voicedDb.length
  );
  const volumeLabel = meanDb < QUIET_DB ? "quiet" : meanDb > LOUD_DB ? "loud" : "good";

  // Pitch variation over voiced frames that produced a confident F0.
  const f0s = clip.filter((s, i) => clipVoiced[i] && s.f0).map((s) => s.f0);
  let pitch = null;
  if (f0s.length >= MIN_PITCH_FRAMES) {
    const sortedF0 = [...f0s].sort((a, b) => a - b);
    const median = percentile(sortedF0, 0.5);
    // Semitone distance from the speaker's own median — gender/pitch-range
    // independent, so it measures variation rather than voice type.
    const st = f0s.map((f) => 12 * Math.log2(f / median));
    const meanSt = st.reduce((a, b) => a + b, 0) / st.length;
    const stdev = Math.sqrt(st.reduce((a, b) => a + (b - meanSt) ** 2, 0) / st.length);
    const range = 12 * Math.log2(percentile(sortedF0, 0.9) / percentile(sortedF0, 0.1));
    pitch = {
      stdev: +stdev.toFixed(2),
      rangeSt: +range.toFixed(1),
      medianHz: Math.round(median),
      label: stdev < MONOTONE_ST ? "monotone" : stdev <= EXPRESSIVE_ST ? "some variation" : "expressive",
    };
  }

  // Sparkline: downsampled volume curve + pause positions (for StatsPanel).
  const bucketSize = Math.max(1, Math.floor(clip.length / SPARK_BUCKETS));
  const spark = [];
  for (let i = 0; i < clip.length; i += bucketSize) {
    let peak = -Infinity;
    for (let j = i; j < Math.min(i + bucketSize, clip.length); j++) peak = Math.max(peak, clip[j].rmsDb);
    spark.push(peak);
  }

  // Tips: pick the weakest areas, keep it to a few honest suggestions.
  const tips = [];
  if (longestPause > 3 || pausesPerMin > 5) {
    tips.push("Long or frequent pauses — grab a keyword hint the moment you feel a stall coming.");
  }
  if (meanDb < QUIET_DB) tips.push("Your average level was low — try projecting a little more.");
  if (volumeStdev > STEADY_VOLUME_STDEV_DB) {
    tips.push("Your volume swung quite a bit — aim for a steadier speaking level.");
  }
  if (pitch && pitch.stdev < MONOTONE_ST) {
    tips.push("Your pitch stayed very flat — exaggerate emphasis on the words that matter.");
  }
  if (pauses.length > 0 && pausesPerMin < 1 && spanSeconds > 30) {
    tips.push("Almost no pauses — a short beat between sentences helps listeners follow you.");
  }

  return {
    voicedSeconds: +voicedSeconds.toFixed(1),
    spanSeconds: +spanSeconds.toFixed(1),
    pauseCount: pauses.length,
    longestPause: +longestPause.toFixed(1),
    silencePct: spanSeconds > 0 ? Math.round((pauseTotal / spanSeconds) * 100) : 0,
    pausesPerMin: +pausesPerMin.toFixed(1),
    meanDb: +meanDb.toFixed(1),
    volumeStdev: +volumeStdev.toFixed(1),
    volumeLabel,
    pitch,
    spark,
    sparkPauses: pauses.map((p) => p.t / Math.max(spanSeconds, 1e-6)), // 0..1 along the curve
    tips: tips.slice(0, 3),
  };
}
