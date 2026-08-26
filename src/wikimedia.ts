import type { ReferenceImage } from "./types";

interface WikimediaImageInfo {
  url: string;
  thumburl?: string;
}

interface WikimediaPage {
  title: string;
  imageinfo?: WikimediaImageInfo[];
}

interface WikimediaResponse {
  query?: {
    pages?: Record<string, WikimediaPage>;
  };
}

// Free, no API key or account required. Searches the File: namespace on
// Wikimedia Commons, which has decent photo coverage for any car common
// enough to be identified from a snapshot in the first place.
export async function searchReferenceImages(query: string): Promise<ReferenceImage[]> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", `${query} filetype:bitmap`);
  url.searchParams.set("gsrnamespace", "6"); // File: namespace
  url.searchParams.set("gsrlimit", "5");
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url");
  url.searchParams.set("iiurlwidth", "800");

  const res = await fetch(url.toString(), {
    headers: {
      // Wikimedia's API etiquette asks callers to identify themselves;
      // requests without a descriptive User-Agent can be rate-limited.
      "User-Agent": "car-scanner/1.0 (personal project; Cloudflare Worker)",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Wikimedia Commons request failed with status ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as WikimediaResponse;
  const pages = data.query?.pages ? Object.values(data.query.pages) : [];

  return pages
    .filter((page): page is WikimediaPage & { imageinfo: WikimediaImageInfo[] } =>
      Array.isArray(page.imageinfo) && page.imageinfo.length > 0,
    )
    .slice(0, 3)
    .map((page) => {
      const info = page.imageinfo[0];
      return {
        url: info.thumburl ?? info.url,
        title: page.title.replace(/^File:/, ""),
        source: "Wikimedia Commons",
      };
    });
}
