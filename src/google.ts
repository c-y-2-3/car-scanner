import type { ReferenceImage } from "./types";

interface GoogleCseResponse {
  items?: Array<{
    link: string;
    title?: string;
    displayLink?: string;
  }>;
}

export async function searchReferenceImages(
  apiKey: string,
  cx: string,
  query: string,
): Promise<ReferenceImage[]> {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", "3");
  url.searchParams.set("safe", "active");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Google Custom Search request failed with status ${res.status}`);
  }

  const data = (await res.json()) as GoogleCseResponse;

  return (data.items ?? []).slice(0, 3).map((item) => ({
    url: item.link,
    title: item.title ?? query,
    source: item.displayLink ?? "",
  }));
}
