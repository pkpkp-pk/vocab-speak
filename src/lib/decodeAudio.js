// Decode a recorded Blob (webm/opus from MediaRecorder) to the exact format
// wav2vec2 wants: mono Float32Array at 16 kHz. Capped to keep on-device
// inference time bounded — long sessions only get their first chunk scored.

export const TARGET_SAMPLE_RATE = 16000;
export const MAX_ANALYZED_SECONDS = 90;

export async function decodeToMono16k(blob, maxSeconds = MAX_ANALYZED_SECONDS) {
  const arrayBuffer = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const seconds = Math.min(audioBuffer.duration, maxSeconds);
    const targetLength = Math.max(1, Math.floor(seconds * TARGET_SAMPLE_RATE));

    // OfflineAudioContext resamples + downmixes to 1 channel for free.
    const offline = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offline.destination);
    source.start(0, 0, seconds);
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  } finally {
    ctx.close().catch(() => {});
  }
}
