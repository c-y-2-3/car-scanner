import Anthropic from "@anthropic-ai/sdk";
import type { CarResult, ImageMediaType } from "./types";

const MODEL = "claude-sonnet-5";

const CAR_SCHEMA = {
  type: "object",
  properties: {
    is_car: {
      type: "boolean",
      description: "Whether the photo clearly shows a car (not a truck/motorcycle/other object, not too blurry to tell).",
    },
    make: { type: ["string", "null"] },
    model: { type: ["string", "null"] },
    year_range: {
      type: ["string", "null"],
      description: "A year range, e.g. '2018-2020'. Never a single year.",
    },
    confidence: {
      type: "number",
      description: "0 to 1. How confident you are in this identification.",
    },
    distinguishing_features: {
      type: ["string", "null"],
      description: "One sentence on the visual details used to identify it (badges, grille, headlight/taillight shape, proportions).",
    },
    summary: {
      type: ["string", "null"],
      description: "1-2 sentence summary of the car.",
    },
    facts: {
      type: "array",
      items: { type: "string" },
      description:
        "Exactly 2-3 short, interesting facts about this car, one sentence each, no filler. Empty array if is_car is false or you couldn't identify it.",
    },
    price_estimate: {
      type: ["string", "null"],
      description:
        "A brief current used-market price range in USD, e.g. '$18,000-$24,000'. At most one short clarifying clause after it if genuinely needed. Null if is_car is false, you couldn't identify it, or you can't find a reliable estimate.",
    },
  },
  required: [
    "is_car",
    "make",
    "model",
    "year_range",
    "confidence",
    "distinguishing_features",
    "summary",
    "facts",
    "price_estimate",
  ],
  additionalProperties: false,
} as const;

class RefusedError extends Error {
  constructor(context: string) {
    super(`Request refused by model safety systems: ${context}`);
  }
}

export async function identifyCar(
  apiKey: string,
  imageBase64: string,
  mediaType: ImageMediaType,
): Promise<CarResult> {
  const client = new Anthropic({ apiKey });
  const t0 = Date.now();

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 1536,
    // Thinking stays on (adaptive, the default) rather than disabled: this
    // call can use the web_search tool, and disabling thinking alongside
    // tool use + a forced JSON schema is a known bad combination — the
    // model can write the tool call as plain text instead of an actual
    // tool_use block, which then fails to parse and drops the result.
    thinking: { type: "adaptive" },
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: CAR_SCHEMA },
    },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 1 }],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          {
            type: "text",
            text: [
              "You are identifying a car from a photo, and if you can identify it, providing a couple of facts and a price estimate.",
              "",
              "Step 1: look carefully at the body shape, badges, grille, headlights, taillights, and overall proportions.",
              "",
              'If the photo does not clearly show a car — a different kind of vehicle, an unrelated object, a person, or something too blurry or obscured to judge — set is_car to false, confidence to 0, leave make/model/year_range/distinguishing_features/summary null, leave facts as an empty array, and price_estimate null. Do not use the web_search tool in this case.',
              "",
              'If it is a car: identify the make, model, and a year range rather than a single year, since styling changes are often subtle year to year (e.g. "2018-2020"). Set confidence between 0 and 1 based on how sure you actually are — an honest low-confidence answer is better than a confident wrong one. Note the visual details you used to identify it, and write a short summary.',
              "",
              "Step 2: only if you identified the car with reasonable confidence, use the web_search tool once to look up 2-3 short, interesting facts and a brief current used-market price range in USD. Keep both concise — no filler, no lengthy explanation.",
            ].join("\n"),
          },
        ],
      },
    ],
  });

  for await (const event of stream) {
    const elapsed = Date.now() - t0;
    if (event.type === "content_block_start") {
      console.log(`[timing] ${event.content_block.type} block started at ${elapsed}ms`);
    } else if (event.type === "message_delta" && event.delta.stop_reason) {
      console.log(`[timing] stop_reason=${event.delta.stop_reason} at ${elapsed}ms`);
    }
  }

  const response = await stream.finalMessage();
  console.log(`[timing] identifyCar total: ${Date.now() - t0}ms`);

  if (response.stop_reason === "refusal") {
    throw new RefusedError("identification");
  }

  return parseJsonResponse(response, validateCarResult);
}

function parseJsonResponse<T>(response: Anthropic.Message, validate: (value: unknown) => T): T {
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  const lastText = textBlocks[textBlocks.length - 1];
  if (!lastText) {
    const blockTypes = response.content.map((b) => b.type).join(", ") || "none";
    throw new Error(`Model returned no text content (stop_reason=${response.stop_reason}, blocks=[${blockTypes}])`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(lastText.text);
  } catch {
    throw new Error(`Model did not return valid JSON (stop_reason=${response.stop_reason}): ${lastText.text.slice(0, 200)}`);
  }

  return validate(parsed);
}

function validateCarResult(value: unknown): CarResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("Response was not an object");
  }
  const v = value as Record<string, unknown>;
  if (typeof v.is_car !== "boolean") throw new Error("Response missing is_car");
  if (typeof v.confidence !== "number") throw new Error("Response missing confidence");

  const facts = Array.isArray(v.facts) ? v.facts.filter((f): f is string => typeof f === "string") : [];

  return {
    is_car: v.is_car,
    make: typeof v.make === "string" ? v.make : null,
    model: typeof v.model === "string" ? v.model : null,
    year_range: typeof v.year_range === "string" ? v.year_range : null,
    confidence: Math.max(0, Math.min(1, v.confidence)),
    distinguishing_features: typeof v.distinguishing_features === "string" ? v.distinguishing_features : null,
    summary: typeof v.summary === "string" ? v.summary : null,
    facts,
    price_estimate: typeof v.price_estimate === "string" ? v.price_estimate : null,
  };
}
