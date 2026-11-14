import { type Fetch, getJson } from "./http";
import type { DeezerSource, DeezerTrack } from "./types";

interface RawTrack {
  id?: number;
  error?: unknown;
  title: string;
  duration: number;
  bpm?: number;
  preview?: string;
  artist?: { name: string };
  contributors?: Array<{ name: string }>;
  album?: { id: number; cover_xl?: string };
}

interface RawAlbum {
  genres?: { data: Array<{ name: string }> };
}

export function deezer({ fetchFn = fetch }: { fetchFn?: Fetch } = {}): DeezerSource {
  const albumGenres = new Map<number, Promise<string[]>>();

  const genresFor = (albumId: number) => {
    let p = albumGenres.get(albumId);
    if (!p) {
      p = getJson<RawAlbum & { error?: unknown }>("deezer", `https://api.deezer.com/album/${albumId}`, { fetchFn }).then(
        (a) => (a && !a.error ? (a.genres?.data ?? []).map((g) => g.name) : []),
      );
      albumGenres.set(albumId, p);
    }
    return p;
  };

  return {
    async byIsrc(isrc): Promise<DeezerTrack | null> {
      const t = await getJson<RawTrack>("deezer", `https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`, {
        fetchFn,
      });
      // Deezer answers 200 with an error body for unknown ISRCs.
      if (!t || t.error || !t.id) return null;
      const artists = t.contributors?.length ? t.contributors.map((c) => c.name) : t.artist ? [t.artist.name] : [];
      return {
        deezerId: t.id,
        title: t.title,
        artists,
        durationMs: t.duration * 1000,
        artworkUrl: t.album?.cover_xl ?? null,
        bpm: t.bpm && t.bpm > 0 ? t.bpm : null,
        previewUrl: t.preview || null,
        genres: t.album ? await genresFor(t.album.id) : [],
      };
    },
  };
}
