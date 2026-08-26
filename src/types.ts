export interface Env {
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;
}

export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface IdentifyRequestBody {
  image: string;
  mediaType?: string;
}

export interface CarResult {
  is_car: boolean;
  make: string | null;
  model: string | null;
  year_range: string | null;
  confidence: number;
  distinguishing_features: string | null;
  summary: string | null;
  facts: string[];
  price_estimate: string | null;
}

export interface ReferenceImage {
  url: string;
  title: string;
  source: string;
}

export interface IdentifyResponse {
  identified: boolean;
  message?: string;
  make?: string;
  model?: string;
  year_range?: string;
  confidence?: number;
  low_confidence?: boolean;
  summary?: string;
  distinguishing_features?: string;
  facts?: string[];
  price_estimate?: string | null;
  reference_images?: ReferenceImage[];
}
