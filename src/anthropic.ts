import Anthropic from "@anthropic-ai/sdk";
import type { CarFacts, CarIdentification, ImageMediaType } from "./types";

const MODEL = "claude-sonnet-5";

const IDENTIFY_SCHEMA = {
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
  },
  required: ["is_car", "make", "model", "year_range", "confidence", "distinguishing_features", "summary"],
  additionalProperties: false,
} as const;

const FACTS_SCHEMA = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      items: { type: "string" },
      description: "3-5 short, interesting, factual bullet points about this car.",
    },
    price_estimate: {
      type: ["string", "null"],
      description: "Rough current used-market price range in USD, e.g. '$18,000-$24,000'. Null if you can't find a reliable estimate.",
    },
  },
  required: ["facts", "price_estimate"],
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
): Promise<CarIdentification> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: "disabled" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: IDENTIFY_SCHEMA },
    },
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
              "You are identifying a car from a photo. Look carefully at the body shape, badges, grille, headlights, taillights, and overall proportions.",
              "",
              "If the photo does not clearly show a car — a different kind of vehicle, an unrelated object, a person, or something too blurry or obscured to judge — set is_car to false, confidence to 0, and leave the other fields null.",
              "",
              "If it is a car, identify the make, model, and a year range rather than a single year, since styling changes are often subtle year to year (e.g. \"2018-2020\"). Set confidence between 0 and 1 based on how sure you actually are — an honest low-confidence answer is better than a confident wrong one. Note the visual details you used to identify it, and write a short summary.",
            ].join("\n"),
          },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new RefusedError("identification");
  }

  return parseJsonResponse(response, validateIdentification);
}

export async function getCarFacts(apiKey: string, make: string, model: string, yearRange: string): Promise<CarFacts> {
  const client = new Anthropic({ apiKey });

  const label = [yearRange, make, model].filter(Boolean).join(" ");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1536,
    thinking: { type: "disabled" },
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: FACTS_SCHEMA },
    },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 2 }],
    messages: [
      {
        role: "user",
        content: `In a single web search, look up a few key facts and a rough current used-market price range in USD for a ${label}. Then summarize what you found.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new RefusedError("facts lookup");
  }

  return parseJsonResponse(response, validateFacts);
}

function parseJsonResponse<T>(response: Anthropic.Message, validate: (value: unknown) => T): T {
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  const lastText = textBlocks[textBlocks.length - 1];
  if (!lastText) {
    throw new Error("Model returned no text content");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(lastText.text);
  } catch {
    throw new Error("Model did not return valid JSON");
  }

  return validate(parsed);
}

function validateIdentification(value: unknown): CarIdentification {
  if (typeof value !== "object" || value === null) {
    throw new Error("Identification response was not an object");
  }
  const v = value as Record<string, unknown>;
  if (typeof v.is_car !== "boolean") throw new Error("Identification response missing is_car");
  if (typeof v.confidence !== "number") throw new Error("Identification response missing confidence");

  return {
    is_car: v.is_car,
    make: typeof v.make === "string" ? v.make : null,
    model: typeof v.model === "string" ? v.model : null,
    year_range: typeof v.year_range === "string" ? v.year_range : null,
    confidence: Math.max(0, Math.min(1, v.confidence)),
    distinguishing_features: typeof v.distinguishing_features === "string" ? v.distinguishing_features : null,
    summary: typeof v.summary === "string" ? v.summary : null,
  };
}

function validateFacts(value: unknown): CarFacts {
  if (typeof value !== "object" || value === null) {
    throw new Error("Facts response was not an object");
  }
  const v = value as Record<string, unknown>;
  const facts = Array.isArray(v.facts) ? v.facts.filter((f): f is string => typeof f === "string") : [];

  return {
    facts,
    price_estimate: typeof v.price_estimate === "string" ? v.price_estimate : null,
  };
}
