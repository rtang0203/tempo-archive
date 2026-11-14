import { type Fetch, SourceError } from "./http";
import type { Analyzer, AnalyzerFeatures } from "./types";

/** Client for the Essentia analyzer service (handoff step 3). */
export function analyzerClient(baseUrl: string, { fetchFn = fetch }: { fetchFn?: Fetch } = {}): Analyzer {
  return {
    async analyze(previewUrl) {
      const res = await fetchFn(`${baseUrl}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preview_url: previewUrl }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new SourceError("essentia", res.status, await res.text());
      return (await res.json()) as AnalyzerFeatures;
    },
  };
}
