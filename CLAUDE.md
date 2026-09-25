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

- `npm run dev` / `npm run build` — plain Vite, no pre-steps.
- `node scripts/test-audio-libs.mjs` — unit suite for the pure analysis libs
  (plus an SSR render check of TranscriptHeatmap via vite's middleware mode).
  Run it after touching anything in `src/lib/` or the heatmap. Currently 54 checks.

## Architecture

```
src/
  App.jsx                     stage machine; finishSession() computes all stats
  data/topics.js              built-in topic pool
  hooks/
    useSpeechRecognition.js   Chrome SpeechRecognition wrapper
    useAudioAnalysis.js       Web Audio sampler: {t, rmsDb, f0} at ~60 Hz
    useLocalStorage.js
  lib/
    analyzeSpeech.js          WPM, filler words, keyword usage from transcript
    analyzeVocabulary.js      diversity (MATR), content-word overuse, keyword timing
    analyzeAudio.js           pauses/volume/pitch; voicedMask(), voicedRegions()
    pitch.js                  YIN-lite F0 detection
    alignTranscript.js        transcript↔waveform alignment (see gotchas)
    decodeAudio.js            MediaRecorder blob → 16 kHz mono PCM (90s cap)
    forcedAlign.js            CTC forced alignment + greedy decode (pure)
    pronunciation.js          worker wrapper (+ prewarmPronunciation)
    pronunciation.worker.js   wav2vec2-base-960h q8 on-device scoring
  components/
    SessionScreen.jsx         timer + live transcript + MediaRecorder
    StatsPanel.jsx            results: stat blocks, sparkline, fillers, heatmap
    PronunciationPanel.jsx    per-word pronunciation chips (auto-run, silent)
    TranscriptHeatmap.jsx     per-word loudness highlight + pause pills
    CustomTopicModal.jsx      user-added topics (localStorage)
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
- **Brave has NO working SpeechRecognition** — ships the API object but strips
  Google's server-ASR keys, so start() always errors `network` (shields state
  irrelevant). Hook detects via `navigator.brave.isBrave()` and reports
  `supported: false` → UI shows the unsupported-browser note. 2026-09-25.
- **Android Chrome delegates recognition to the Google app's speech service** —
  when that is missing/disabled it hangs SILENTLY (no onerror, no onresult,
  "listening…" forever). useSpeechRecognition has a 10 s no-result watchdog
  (`gotResultRef`) that surfaces this as error code `no-results`; onresult
  clears it. Diagnosed on-device 2026-09-24 with an isolated config matrix:
  `lang="en-US"` and `interimResults: true` each made the recognizer hear
  speech yet return zero results; bare config worked ONCE then the API went
  erratic device-wide (google.com voice search unaffected — it bypasses this
  API). Conclusion: Chrome Android SpeechRecognition is unreliable on some
  devices; watchdog + honest error is the app-side ceiling.
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
  implied lag clamped [0.25, 1.75]s, spread > 1.5s → default 0.7. The optional
  4th `wordSpans` param (skips the lag heuristic, measured timings) is fed by
  the pronunciation stack when its analysis completes (see below).
- `voicedMask(samples, floorDb)` takes an optional MEASURED noise floor from
  the SessionScreen mic check (`checkMic` in useAudioAnalysis). The adaptive
  p10 fallback inflates into quiet speech for fluent nonstop talkers — the
  floor-bias regression test ("nonstop talker") pins this.
- `alignTranscript` returns `{ tokens, leftoverCount, leftoverSeconds,
  lagSeconds, lagCalibrated } | null`, NOT a bare array. Pause markers
  subtract skipped-over regions from the gap.

**On-device ASR (Moonshine)** — REMOVED (user call, 2026-09-23): the
onnxruntime-web wasm decoder crashed ("Missing required scale") and value
overlapped with Gemini live. asr.worker.js/asr.js/asrChunks.js/AsrPanel gone;
`voicedRegions()` stays (alignTranscript uses it).

**Gemini features** — REMOVED (user call, 2026-09-24): live transcription
engine (useGeminiLive.js, geminiLive.js, pcm16.worklet.js, resample.js), AI
coach (aiCoach.js, CoachPanel.jsx, wav.js), and the `speakstage.geminiKey`/
`speakstage.geminiLive` settings. Chrome SpeechRecognition is now the ONLY
transcript engine — non-Chrome browsers get no transcript (accepted
trade-off, same as after the Moonshine removal). Old gemini* localStorage
keys are orphaned in place; harmless.

**TranscriptHeatmap**
- Tokens from `.map()` MUST have real whitespace between them
  (`{i > 0 && " "}` in a Fragment). Adjacent elements have no break
  opportunities → the whole row is one unbreakable word → overflows the card.
  Regression-tested in the suite via SSR markup check.

**Deep pronunciation stack** — RESTORED, slimmed (user call, 2026-09-25):
PronunciationPanel, pronunciation.js/.worker.js, forcedAlign.js,
decodeAudio.js, and the `@huggingface/transformers` dep are back (wav2vec2
CTC forced alignment, ~95 MB q8 model). Differences from the old stack:
- Auto-run always: App prewarms the worker when a session starts (model
  downloads during speaking), PronunciationPanel runs on mount and renders
  NOTHING until scores exist — no toggle, no progress bar, no download UI.
  Failure degrades to a one-line note + retry.
- No fetch-model.mjs / public/models / vercel.json: the worker pulls the
  model from the Hugging Face hub at runtime; the browser's Cache API makes
  it a once-per-browser download. (Requires a secure context — localhost or
  HTTPS — to persist; plain-HTTP LAN origins re-download every visit.)
- `speakstage.deepAnalysis` toggle NOT restored (orphaned key stays unused).
alignTranscript's `wordSpans` param has a producer again: PronunciationPanel
passes measured spans up via `onWordSpans` → App.applyWordSpans, upgrading
the heatmap in place.

## Deployment

Vercel static build, default Vite preset (`npm run build` → `dist/`). No
build-time downloads, no headers config, no env vars needed. The wav2vec2
model downloads at RUNTIME from the Hugging Face hub (browser-cached).

## AI features — ALL REMOVED

AI topics (Anthropic BYO key) removed 2026-09-25 (user call): Header AI-mode
toggle + settings gear, AISettingsModal, aiTopics.js, `speakstage.aiMode`/
`speakstage.apiKey` state. App is now fully offline except Chrome's speech
recognition (which sends audio to Google — see footer). Earlier removals:
Gemini live + coach (2026-09-24). The pronunciation stack was removed
2026-09-24 and RESTORED in slimmed auto-run form 2026-09-25 — see above.
Orphaned localStorage keys (`geminiKey`, `geminiLive`, `deepAnalysis`,
`aiMode`, `apiKey`) stay harmlessly in existing users' browsers.

## Naming

App renamed to **Vocab Speak** (header, title, README, package.json).
`speakstage.*` localStorage keys intentionally kept — renaming them would wipe
existing users' streaks and settings.

## Pending / discussed, not approved

- User to verify live transcript + filler recovery in Chrome, then redeploy.
- ~~`en-IN` language option~~ — moot: recognition now uses the device default
  locale (hardcoded `en-US` was provably harmful on Android, 2026-09-24).
