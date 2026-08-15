import { getCarFacts, identifyCar } from "./anthropic";
import { searchReferenceImages } from "./google";
import type { Env, IdentifyRequestBody, IdentifyResponse, ImageMediaType } from "./types";

const LOW_CONFIDENCE_THRESHOLD = 0.6;
const MIN_CONFIDENCE_TO_IDENTIFY = 0.2;
// Client resizes to ~1200px / JPEG quality 0.8 before upload, so a generous
// ceiling here just guards against something bypassing the client resize.
const MAX_BASE64_LENGTH = 8 * 1024 * 1024;

const SUPPORTED_MEDIA_TYPES: ImageMediaType[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export async function handleIdentify(request: Request, env: Env): Promise<Response> {
  let body: IdentifyRequestBody;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ identified: false, message: "Invalid request body." }, 400);
  }

  if (!body || typeof body.image !== "string" || body.image.length === 0) {
    return jsonResponse({ identified: false, message: "No image provided." }, 400);
  }

  const { data: imageBase64, mediaType } = parseImageInput(body.image, body.mediaType);

  if (imageBase64.length > MAX_BASE64_LENGTH) {
    return jsonResponse({ identified: false, message: "That image is too large." }, 413);
  }

  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse(
      { identified: false, message: "The server is missing its Anthropic API key. Run `wrangler secret put ANTHROPIC_API_KEY`." },
      500,
    );
  }

  let identification;
  try {
    identification = await identifyCar(env.ANTHROPIC_API_KEY, imageBase64, mediaType);
  } catch (err) {
    console.error("Identification call failed", err);
    return jsonResponse(
      { identified: false, message: "Couldn't analyze that photo right now. Please try again." },
      502,
    );
  }

  if (
    !identification.is_car ||
    !identification.make ||
    !identification.model ||
    identification.confidence < MIN_CONFIDENCE_TO_IDENTIFY
  ) {
    return jsonResponse({
      identified: false,
      message: "Couldn't confidently identify a car in this photo. Try a clearer shot of the front or side of the vehicle.",
    });
  }

  const make = identification.make;
  const model = identification.model;
  const yearRange = identification.year_range ?? "";

  const canSearchImages = Boolean(env.GOOGLE_CSE_API_KEY && env.GOOGLE_CSE_CX);

  const [factsResult, imagesResult] = await Promise.allSettled([
    getCarFacts(env.ANTHROPIC_API_KEY, make, model, yearRange),
    canSearchImages
      ? searchReferenceImages(env.GOOGLE_CSE_API_KEY, env.GOOGLE_CSE_CX, `${yearRange} ${make} ${model}`.trim())
      : Promise.resolve([]),
  ]);

  if (factsResult.status === "rejected") {
    console.error("Facts lookup failed", factsResult.reason);
  }
  if (imagesResult.status === "rejected") {
    console.error("Reference image search failed", imagesResult.reason);
  }

  const response: IdentifyResponse = {
    identified: true,
    make,
    model,
    year_range: identification.year_range ?? undefined,
    confidence: identification.confidence,
    low_confidence: identification.confidence < LOW_CONFIDENCE_THRESHOLD,
    summary: identification.summary ?? undefined,
    distinguishing_features: identification.distinguishing_features ?? undefined,
    facts: factsResult.status === "fulfilled" ? factsResult.value.facts : [],
    price_estimate: factsResult.status === "fulfilled" ? factsResult.value.price_estimate : null,
    reference_images: imagesResult.status === "fulfilled" ? imagesResult.value : [],
  };

  return jsonResponse(response, 200);
}

function parseImageInput(image: string, mediaTypeHint?: string): { data: string; mediaType: ImageMediaType } {
  const dataUrlMatch = image.match(/^data:(image\/[a-zA-Z]+);base64,([\s\S]*)$/);
  if (dataUrlMatch) {
    return { data: dataUrlMatch[2], mediaType: coerceMediaType(dataUrlMatch[1]) };
  }
  return { data: image, mediaType: coerceMediaType(mediaTypeHint) };
}

function coerceMediaType(value: string | undefined): ImageMediaType {
  if (value && (SUPPORTED_MEDIA_TYPES as string[]).includes(value)) {
    return value as ImageMediaType;
  }
  return "image/jpeg";
}

function jsonResponse(body: IdentifyResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
