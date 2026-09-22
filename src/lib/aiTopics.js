// Bonus mode: generate a fresh topic + rescue keywords on demand using the
// user's own Anthropic API key (stored only in localStorage, sent only to
// api.anthropic.com). Local mode never needs this file at all.

const MODEL = "claude-sonnet-4-6";

// A hung network request would otherwise leave the slot machine spinning
// forever — abort after this long and fall back to a local topic.
const REQUEST_TIMEOUT_MS = 15000;

export async function generateAITopic({ apiKey, category, difficulty }) {
  if (!apiKey) throw new Error("Missing API key");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: `Generate one spontaneous-speaking practice topic for an English vocabulary/fluency app.
Category: ${category === "all" ? "any" : category}. Difficulty: ${difficulty === "all" ? "intermediate" : difficulty}.
Respond with ONLY raw JSON, no markdown fences, no preamble, matching exactly this shape:
{"title": "string, under 8 words", "prompt": "one sentence instructing the speaker what to talk about", "keywords": ["6 to 8 single words or short phrases the speaker could use as rescue vocabulary if they get stuck"]}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`AI request failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const textBlock = data.content?.find((b) => b.type === "text")?.text ?? "";
    const cleaned = textBlock.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("Couldn't parse the AI response. Try again.");
    }

    return {
      id: `ai-${Date.now()}`,
      category: category === "all" ? "society" : category,
      difficulty: difficulty === "all" ? "intermediate" : difficulty,
      title: parsed.title,
      prompt: parsed.prompt,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      isAI: true,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("AI request timed out — check your connection");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
