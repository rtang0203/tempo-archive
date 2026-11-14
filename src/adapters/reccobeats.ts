import { type Fetch, getJson } from "./http";
import type { ReccoBeatsFeatures, ReccoBeatsSource } from "./types";

interface RawFeatures {
  href: string;
  tempo?: number;
  energy?: number;
  danceability?: number;
}

const BATCH = 40;

export function reccobeats({ fetchFn = fetch }: { fetchFn?: Fetch } = {}): ReccoBeatsSource {
  return {
    async audioFeatures(spotifyIds) {
      const out = new Map<string, ReccoBeatsFeatures>();
      for (let i = 0; i < spotifyIds.length; i += BATCH) {
        const ids = spotifyIds.slice(i, i + BATCH).join(",");
        const res = await getJson<{ content: RawFeatures[] }>(
          "reccobeats",
          `https://api.reccobeats.com/v1/audio-features?ids=${ids}`,
          { fetchFn },
        );
        for (const f of res?.content ?? []) {
          const id = f.href.split("/").pop();
          if (!id) continue;
          out.set(id, {
            tempo: f.tempo && f.tempo > 0 ? f.tempo : null,
            energy: f.energy ?? null,
            danceability: f.danceability ?? null,
          });
        }
      }
      return out;
    },
  };
}
