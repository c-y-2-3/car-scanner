import { getCarFacts } from "./anthropic";
import { searchReferenceImages } from "./google";
import type { EnrichRequestBody, EnrichResponse, Env } from "./types";

export async function handleEnrich(request: Request, env: Env): Promise<Response> {
  let body: EnrichRequestBody;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(emptyResponse(), 400);
  }

  if (!body || typeof body.make !== "string" || typeof body.model !== "string" || !body.make || !body.model) {
    return jsonResponse(emptyResponse(), 400);
  }

  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse(emptyResponse(), 500);
  }

  const yearRange = body.year_range ?? "";
  const canSearchImages = Boolean(env.GOOGLE_CSE_API_KEY && env.GOOGLE_CSE_CX);

  const [factsResult, imagesResult] = await Promise.allSettled([
    getCarFacts(env.ANTHROPIC_API_KEY, body.make, body.model, yearRange),
    canSearchImages
      ? searchReferenceImages(env.GOOGLE_CSE_API_KEY, env.GOOGLE_CSE_CX, `${yearRange} ${body.make} ${body.model}`.trim())
      : Promise.resolve([]),
  ]);

  if (factsResult.status === "rejected") {
    console.error("Facts lookup failed", factsResult.reason);
  }
  if (imagesResult.status === "rejected") {
    console.error("Reference image search failed", imagesResult.reason);
  }

  const response: EnrichResponse = {
    facts: factsResult.status === "fulfilled" ? factsResult.value.facts : [],
    price_estimate: factsResult.status === "fulfilled" ? factsResult.value.price_estimate : null,
    reference_images: imagesResult.status === "fulfilled" ? imagesResult.value : [],
  };

  return jsonResponse(response, 200);
}

function emptyResponse(): EnrichResponse {
  return { facts: [], price_estimate: null, reference_images: [] };
}

function jsonResponse(body: EnrichResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
