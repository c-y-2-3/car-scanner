import { handleIdentify } from "./identify";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/identify") {
      if (request.method !== "POST") {
        return jsonError("Method not allowed", 405);
      }
      return handleIdentify(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return jsonError("Not found", 404);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
