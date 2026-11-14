import { type Fetch, getJson } from "./http";
import type { PreviewSearch } from "./types";

interface RawResult {
  artistName: string;
  trackName: string;
  previewUrl?: string;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** iTunes has no ISRC lookup, so search by artist + title and require the artist to match. */
export function itunes({ fetchFn = fetch }: { fetchFn?: Fetch } = {}): PreviewSearch {
  return {
    async findPreview(artist, title) {
      const term = encodeURIComponent(`${artist} ${title}`);
      const res = await getJson<{ results: RawResult[] }>(
        "itunes",
        `https://itunes.apple.com/search?entity=song&limit=5&term=${term}`,
        { fetchFn },
      );
      const want = norm(artist);
      const hit = res?.results.find((r) => r.previewUrl && norm(r.artistName).includes(want));
      return hit?.previewUrl ?? null;
    },
  };
}
