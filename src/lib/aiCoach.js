// Optional AI coach: upload the session recording to Google's Gemini API with
// the user's own AI Studio key, for feedback local analysis can't give —
// fillers heard by ear (Chrome's transcript drops them), pronunciation,
// grammar, vocabulary upgrades. Nothing here runs until the user clicks the
// coach button on the results screen.

import { TARGET_SAMPLE_RATE } from "./decodeAudio.js";
import { encodeWavPcm16 } from "./wav.js";

// Retired models 404 for new keys ("no longer available to new users") —
// bump this when Google's error says so.
const MODEL = "gemini-3.6-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
// Longer than the topic request: multi-MB audio upload + multimodal inference.
const REQUEST_TIMEOUT_MS = 60000;

// Chunked btoa — spreading a multi-MB Uint8Array into String.fromCharCode
// blows the call stack.
function toBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Pure — unit-tested. Measured stats go in as ground truth so the model
// spends its effort on what signal processing can't see.
export function buildCoachPrompt({ topic, transcript, stats }) {
  const audio = stats.audio;
  const lines = [
    `You are a supportive English speaking coach. Listen to the attached recording of a learner speaking spontaneously on the topic "${topic.title}" (${topic.prompt}).`,
    "",
    "Measured locally from the waveform (trust these, don't re-derive):",
    `- words per minute: ${stats.wpm}`,
    audio ? `- pauses >= 0.3s: ${audio.pauseCount}, longest ${audio.longestPause}s` : null,
    audio ? `- average volume: ${audio.meanDb} dBFS (${audio.volumeLabel})` : null,
    audio?.pitch ? `- pitch variety: ${audio.pitch.label}` : null,
    "",
    transcript
      ? `Browser speech-recognition transcript (it silently DROPS filler words like "um"/"uh" — listen to the audio to catch them):\n"""${transcript.slice(0, 4000)}"""`
      : "No transcript was captured — transcribe the key parts yourself from the audio.",
    "",
    `Respond with ONLY raw JSON, no markdown fences, matching exactly this shape:
{"summary": "2-3 sentences of honest, encouraging overall feedback",
"fluencyScore": <integer 1-10>,
"fillersHeard": {"um": 2, "uh": 1},
"pronunciation": [{"word": "word as heard", "tip": "how to say it better"}],
"grammar": [{"said": "what they said", "better": "corrected version", "why": "one short reason"}],
"vocabulary": [{"insteadOf": "word or phrase they overused or fumbled", "try": "stronger alternative"}]}
Rules: fillersHeard counts ONLY audible disfluencies (um, uh, hmm, er...) heard in the audio, never legitimate words. At most 4 items each in pronunciation, grammar, vocabulary. Empty object/array if none. No markdown.`,
  ];
  return lines.filter((l) => l !== null).join("\n");
}

export async function analyzeWithGemini({ apiKey, pcm, topic, transcript, stats }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  const wav = encodeWavPcm16(pcm, TARGET_SAMPLE_RATE);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType: "audio/wav", data: toBase64(wav) } },
              { text: buildCoachPrompt({ topic, transcript, stats }) },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 400 || res.status === 403) {
        throw new Error("Gemini rejected the key — check it in settings");
      }
      if (res.status === 429) {
        throw new Error("Gemini rate limit hit — wait a moment and retry");
      }
      throw new Error(`Gemini request failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const textBlock =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const cleaned = textBlock.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("Couldn't parse the coach response. Try again.");
    }

    // Defensive shape — the model occasionally colors outside the lines.
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      fluencyScore: Number.isFinite(parsed.fluencyScore) ? Math.round(parsed.fluencyScore) : null,
      fillersHeard:
        parsed.fillersHeard && typeof parsed.fillersHeard === "object" ? parsed.fillersHeard : {},
      pronunciation: Array.isArray(parsed.pronunciation) ? parsed.pronunciation.slice(0, 4) : [],
      grammar: Array.isArray(parsed.grammar) ? parsed.grammar.slice(0, 4) : [],
      vocabulary: Array.isArray(parsed.vocabulary) ? parsed.vocabulary.slice(0, 4) : [],
    };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Coach request timed out — check your connection");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
