import { identifyCar } from "./anthropic";
import { searchReferenceImages } from "./google";
import type { Env, IdentifyRequestBody, IdentifyResponse, ImageMediaType } from "./types";

const LOW_CONFIDENCE_THRESHOLD = 0.6;
const MIN_CONFIDENCE_TO_IDENTIFY = 0.2;
// Client resizes to ~1200px / JPEG quality 0.8 before upload, so a generous
// ceiling here just guards against something bypassing the client resize.
const MAX_BASE64_LENGTH = 8 * 1024 * 1024;

const SUPPORTED_MEDIA_TYPES: ImageMediaType[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export async function handleIdentify(request: Request, env: Env): Promise<Response> {
  const startedAt = Date.now();
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

  let result;
  try {
    result = await identifyCar(env.ANTHROPIC_API_KEY, imageBase64, mediaType);
    console.log(`identifyCar took ${Date.now() - startedAt}ms`);
  } catch (err) {
    console.error(`Identification call failed after ${Date.now() - startedAt}ms`, err);
    return jsonResponse(
      { identified: false, message: "Couldn't analyze that photo right now. Please try again." },
      502,
    );
  }

  if (!result.is_car || !result.make || !result.model || result.confidence < MIN_CONFIDENCE_TO_IDENTIFY) {
    return jsonResponse({
      identified: false,
      message: "Couldn't confidently identify a car in this photo. Try a clearer shot of the front or side of the vehicle.",
    });
  }

  const make = result.make;
  const model = result.model;
  const yearRange = result.year_range ?? "";
  const canSearchImages = Boolean(env.GOOGLE_CSE_API_KEY && env.GOOGLE_CSE_CX);

  let referenceImages: IdentifyResponse["reference_images"] = [];
  if (canSearchImages) {
    try {
      referenceImages = await searchReferenceImages(
        env.GOOGLE_CSE_API_KEY,
        env.GOOGLE_CSE_CX,
        `${yearRange} ${make} ${model}`.trim(),
      );
    } catch (err) {
      console.error("Reference image search failed", err);
    }
  }

  const response: IdentifyResponse = {
    identified: true,
    make,
    model,
    year_range: result.year_range ?? undefined,
    confidence: result.confidence,
    low_confidence: result.confidence < LOW_CONFIDENCE_THRESHOLD,
    summary: result.summary ?? undefined,
    distinguishing_features: result.distinguishing_features ?? undefined,
    facts: result.facts,
    price_estimate: result.price_estimate,
    reference_images: referenceImages,
  };

  console.log(`Total /api/identify took ${Date.now() - startedAt}ms`);
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
