# CLAUDE.md — Vocab Speak (vocab-speak)

Spontaneous-English-speaking practice app. User picks a topic, talks against a
timer with optional keyword hints, then gets transcript stats plus waveform-based
voice metrics. No backend; deployed as a static site on Vercel.

## Stack & conventions

- React 18 + Vite 8 (rolldown-vite). Plain per-component CSS files (`X.jsx` +
  `X.css`). Tailwind and framer-motion were **deliberately removed** — do not
  reintroduce them or animation/utility CSS frameworks.
- No router. Stage state machine in `src/App.jsx`: `select | session | results`.
- ESM throughout (`"type": "module"`). Test scripts are plain Node `.mjs`.
- This directory path contains a space (`frontend practice`): in Node scripts
  always use `fileURLToPath(new URL(...))`, never `new URL(...).pathname`
  (percent-encoding bug bitten before).
- Do not access any `.claude` folder; it is gitignored.

## Commands

- `npm run dev` / `npm run build` — both run `scripts/fetch-model.mjs` first
  (downloads the wav2vec2 model into `public/models/`, skip-if-present).
- `node scripts/test-audio-libs.mjs` — unit suite for the pure analysis libs
  (plus an SSR render check of TranscriptHeatmap via vite's middleware mode).
  Run it after touching anything in `src/lib/` or the heatmap. Currently 76 checks.

## Architecture

```
src/
  App.jsx                     stage machine; finishSession() computes all stats
  data/topics.js              built-in topic pool
  hooks/
    useSpeechRecognition.js   Chrome SpeechRecognition wrapper
    useGeminiLive.js          Gemini 3.5 Transcribe Live engine (WS, BYO key)
    useAudioAnalysis.js       Web Audio sampler: {t, rmsDb, f0} at ~60 Hz
    useLocalStorage.js
  lib/
    analyzeSpeech.js          WPM, filler words, keyword usage from transcript
    analyzeVocabulary.js      diversity (MATR), content-word overuse, keyword timing
    analyzeAudio.js           pauses/volume/pitch; voicedMask(), voicedRegions()
    pitch.js                  YIN-lite F0 detection
    alignTranscript.js        transcript↔waveform alignment (see gotchas)
    asrChunks.js              silence-bounded chunk planning for on-device ASR
    asr.worker.js, asr.js     Moonshine-base re-transcription worker + wrapper
    forcedAlign.js            CTC alignment; alignStates/charScores/wordSpans
    pronunciation.worker.js   wav2vec2 in a Web Worker (transformers.js v4)
    pronunciation.js, decodeAudio.js  worker wrapper, Blob → 16 kHz mono
    wav.js                    Float32 PCM → 16-bit WAV encoder (pure)
    aiCoach.js                optional BYO-key Gemini coach (audio upload)
    aiTopics.js               optional BYO-key AI topic generation (Anthropic)
    geminiLive.js             Live API WS session (BidiGenerateContent)
    resample.js               boxcar resampler to 16 kHz (keep public/
                              pcm16.worklet.js in sync — raw-served, no imports)
  components/
    SessionScreen.jsx         timer + live transcript + MediaRecorder
    StatsPanel.jsx            results: stat blocks, sparkline, fillers, heatmap
    TranscriptHeatmap.jsx     per-word loudness highlight + pause pills
    PronunciationPanel.jsx    opt-in deep analysis UI
    CoachPanel.jsx            opt-in Gemini coach UI
    AISettingsModal.jsx       two keys: Anthropic (topics) + Gemini (coach)
```

`finishSession` result pipeline: `analyzeSpeech(transcript)` →
`stats.audio = analyzeAudio(samples)` → `stats.annotated = alignTranscript(segments, samples)`.

## Invariants & hard-won gotchas

**Speech recognition**
- Acquire the mic (`getUserMedia`) BEFORE `recognition.start()` — starting both
  at once races the permission prompt and recognition fails with
  `not-allowed`/`audio-capture`.
- `onerror`: fatal codes (`not-allowed`, `audio-capture`, `service-not-allowed`,
  `language-not-supported`) must clear `shouldRestartRef`, otherwise
  `onend → start()` loops forever. `no-speech` is benign.
- Chrome's recognizer is server-side Google ASR: it needs network, **sends
  audio to Google** (footer wording reflects this), and **strips disfluencies**
  ("um"/"uh") from final transcripts.
- Filler recovery exists because of that stripping, two paths:
  (A) `diffStrippedFillers(interim, final)` in analyzeSpeech.js — multiset diff
  of the last interim snapshot vs. the finalized text, filtered to known
  disfluency tokens; accumulated in useSpeechRecognition per result index.
  (B) leftover regions in alignTranscript.js — voiced regions ≤ 0.8 s that no
  transcript words landed on = likely dropped "um"/"uh". Longer unassigned
  regions are missed phrases, not fillers.

**Audio**
- `autoGainControl: false` at capture on purpose — volume stats must reflect
  the speaker, not OS gain riding. Do not enable AGC.
- `useSpeechRecognition` and `useAudioAnalysis` share ONE clock: caller passes
  the same `performance.now()` t0 to both `.start(t0)`. alignTranscript depends
  on identical timebases.
- `alignTranscript` SELF-CALIBRATES the recognition lag: two-pass walk, median
  implied lag clamped [0.25, 1.75]s, spread > 1.5s → default 0.7. When CTC
  `wordSpans` exist (deep-analysis pass) the whole lag heuristic is skipped —
  timings are measured at 20ms resolution.
- `voicedMask(samples, floorDb)` takes an optional MEASURED noise floor from
  the SessionScreen mic check (`checkMic` in useAudioAnalysis). The adaptive
  p10 fallback inflates into quiet speech for fluent nonstop talkers — the
  floor-bias regression test ("nonstop talker") pins this.
- `alignTranscript` returns `{ tokens, leftoverCount, leftoverSeconds,
  lagSeconds, lagCalibrated } | null`, NOT a bare array. Pause markers
  subtract skipped-over regions from the gap.
- Model caching: transformers.js uses the browser Cache API
  ('transformers-cache') — SECURE CONTEXTS ONLY (localhost/HTTPS). Plain-HTTP
  LAN origins re-download every visit; panels warn about it. vite.config.js
  adds immutable headers for /models/ in dev/preview (vercel.json in prod).

**On-device ASR (Moonshine, AsrPanel)**
- Chunks are planned from `voicedRegions` (silence-bounded, ≤25s, 0.2s pad) —
  never blind windows; hard-split only for >25s nonstop speech.
- Worker segments carry real `endedAt` (chunk end) — lag self-calibrates to
  ~0 on that path.
- `applyOnDeviceTranscript` in App.jsx recomputes analyzeSpeech (no
  strippedFillers needed — fillers are IN the text) + vocab + heatmap.

**TranscriptHeatmap**
- Tokens from `.map()` MUST have real whitespace between them
  (`{i > 0 && " "}` in a Fragment). Adjacent elements have no break
  opportunities → the whole row is one unbreakable word → overflows the card.
  Regression-tested in the suite via SSR markup check.

**Deep pronunciation (default-ON; toggle `speakstage.deepAnalysis` is opt-OUT)**
- Model `Xenova/wav2vec2-base-960h` (q8, ~91 MB) served same-origin from
  `/models/` — fetched at build time into gitignored `public/models/`, immutable
  cache headers in `vercel.json`, HF remote fallback stays enabled.
- transformers.js v4 API: `AutoProcessor` has NO tokenizer attached — load
  `AutoTokenizer` separately; `get_vocab()` returns a `Map`, not an object.
- Worker sets `env.localModelPath = "/models/"` and `env.allowLocalModels = true`
  (defaults to false in browsers).
- PronunciationPanel auto-runs on mount; `pronunciation.js` dedupes in-flight
  runs (StrictMode dev double-effect).
- Moonshine dtype gotcha: int8 ("quantized") decoder crashes onnxruntime-WEB
  ("Missing required scale" on embed_tokens) though onnxruntime-NODE accepts
  it. Working combo is `{encoder_model: "q8", decoder_model_merged: "q4"}` —
  must match fetch-model.mjs's file list. scripts/test-asr-model.mjs proves
  the local file set loads/runs (node only; cannot catch wasm-only errors).
- Gemini coach model id lives in `MODEL` in aiCoach.js — retired models 404
  for new keys; bump when the error says so.

## Deployment

Vercel static build. `vercel.json` sets immutable caching for `/models/*`.
`npm run build` fetches the model at build time, so Vercel builds need network
access to huggingface.co on first build (cached in build cache afterwards only
if configured — safe to re-download).

## AI features (both opt-in, BYO key)

- Topics: Anthropic key in `speakstage.apiKey` (Claude API has NO audio input).
- Gemini key in `speakstage.geminiKey` powers two things:
  - **Live transcription** (`useGeminiLive.js` + `geminiLive.js` +
    `public/pcm16.worklet.js`): SessionScreen picks it over Chrome whenever a
    key exists (`engine` alias). Model `gemini-3.5-transcribe-live`, WS URL
    `wss://generativelanguage.googleapis.com/ws/...BidiGenerateContent?key=`,
    audio as `realtimeInput.audio` base64 PCM16 LE `audio/pcm;rate=16000`,
    transcripts arrive as `serverContent.inputTranscription.text`,
    `turnComplete` ends a segment. Interim chunks are defensive: replace when
    cumulative, append when delta.
  - **Coach** (`aiCoach.js`): reuses `decodeToMono16k` (90 s cap) + `wav.js`
    (Gemini doesn't accept webm/opus), posts inline base64 WAV to
    `gemini-3.6-flash` with `responseMimeType: application/json`. Retired
    models 404 for new keys — bump the `MODEL` const when the error says so.

## Naming

App renamed to **Vocab Speak** (header, title, README, package.json).
`speakstage.*` localStorage keys intentionally kept — renaming them would wipe
existing users' streaks, keys, and settings.

## Pending / discussed, not approved

- User to verify live transcript + filler recovery in Chrome, then redeploy.
- `en-IN` language option for recognition (accent fit) — suggested, not built.
