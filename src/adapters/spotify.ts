import { createHash, randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { type Fetch, SourceError } from "./http";

export const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
  "playlist-modify-private",
  "playlist-modify-public",
].join(" ");

export interface SpotifyTokens {
  accessToken: string;
  /** Spotify may rotate the refresh token on refresh; persist the new one when present. */
  refreshToken: string | null;
  expiresAt: Date;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  trackCount: number;
  imageUrl: string | null;
  /** Spotify only returns items for playlists the user owns (Feb 2026 rule). */
  owned: boolean;
}

/** Transient Spotify metadata for an item: title/artists are used during import and never persisted. */
export interface LibraryItem {
  spotifyId: string;
  isrc: string | null;
  title: string;
  artists: string[];
  addedAt: string | null;
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function authorizeUrl(clientId: string, redirectUri: string, state: string, challenge: string): string {
  return `https://accounts.spotify.com/authorize?${new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SPOTIFY_SCOPES,
    state,
  })}`;
}

async function tokenRequest(body: Record<string, string>, fetchFn: Fetch): Promise<SpotifyTokens> {
  const res = await fetchFn("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new SourceError("spotify", res.status, `token: ${await res.text()}`);
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    expiresAt: new Date(Date.now() + t.expires_in * 1000),
  };
}

export const exchangeCode = (clientId: string, code: string, redirectUri: string, verifier: string, fetchFn: Fetch = fetch) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier }, fetchFn);

export const refreshTokens = (clientId: string, refreshToken: string, fetchFn: Fetch = fetch) =>
  tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }, fetchFn);

interface RawTrack {
  id: string | null;
  type?: string;
  name: string;
  is_local?: boolean;
  artists: Array<{ name: string }>;
  external_ids?: { isrc?: string };
}

export interface SpotifyLibrary {
  me(): Promise<{ id: string; display_name: string | null }>;
  playlists(meId: string): Promise<PlaylistSummary[]>;
  playlistItems(playlistId: string): Promise<LibraryItem[]>;
  likedSongs(): Promise<LibraryItem[]>;
  likedCount(): Promise<number>;
  /** One catalog track (for pasted links); null when Spotify doesn't know the ID. */
  track(id: string): Promise<LibraryItem | null>;
  /** Create a private playlist and fill it; returns its Spotify URL. */
  createPlaylist(name: string, description: string, trackIds: string[]): Promise<string>;
}

/** The logged-in user's library, behind one adapter so API changes stay contained. */
export function spotifyLibrary(accessToken: string, { fetchFn = fetch }: { fetchFn?: Fetch } = {}): SpotifyLibrary {
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const url = path.startsWith("https://") ? path : `https://api.spotify.com/v1${path}`;
    for (let attempt = 0; ; attempt++) {
      const res = await fetchFn(url, {
        ...init,
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...init.headers },
      });
      if (res.ok) return (res.status === 204 ? null : await res.json()) as T;
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 500 * 2 ** attempt);
        continue;
      }
      throw new SourceError("spotify", res.status, `${init.method ?? "GET"} ${path}: ${await res.text()}`);
    }
  };

  const pages = async <T>(first: string): Promise<T[]> => {
    const out: T[] = [];
    for (let next: string | null = first; next; ) {
      const page: { items: T[]; next: string | null } = await call(next);
      out.push(...page.items);
      next = page.next;
    }
    return out;
  };

  const toItem = (t: RawTrack | null | undefined, addedAt: string | null): LibraryItem | null =>
    t && t.id && !t.is_local && (t.type ?? "track") === "track"
      ? {
          spotifyId: t.id,
          isrc: t.external_ids?.isrc ?? null,
          title: t.name,
          artists: t.artists.map((a) => a.name),
          addedAt,
        }
      : null;

  return {
    me: () => call<{ id: string; display_name: string | null }>("/me"),

    async playlists(meId: string): Promise<PlaylistSummary[]> {
      const raw = await pages<{
        id: string;
        name: string;
        owner: { id: string; display_name: string | null };
        items?: { total: number };
        tracks?: { total: number };
        images: Array<{ url: string }> | null;
      }>("/me/playlists?limit=50");
      // Spotify's pages can overlap and repeat a playlist; keep the first occurrence.
      const unique = [...new Map(raw.filter((p) => p?.id).map((p) => [p.id, p])).values()];
      return unique.map((p) => ({
        id: p.id,
        name: p.name,
        ownerId: p.owner.id,
        ownerName: p.owner.display_name ?? p.owner.id,
        trackCount: p.items?.total ?? p.tracks?.total ?? 0,
        imageUrl: p.images?.[0]?.url ?? null,
        owned: p.owner.id === meId,
      }));
    },

    async playlistItems(playlistId: string): Promise<LibraryItem[]> {
      const raw = await pages<{ added_at: string | null; item?: RawTrack; track?: RawTrack }>(
        `/playlists/${playlistId}/items?limit=50`,
      );
      return raw.map((r) => toItem(r.item ?? r.track, r.added_at)).filter((x): x is LibraryItem => x !== null);
    },

    async likedSongs(): Promise<LibraryItem[]> {
      const raw = await pages<{ added_at: string; track: RawTrack }>("/me/tracks?limit=50");
      return raw.map((r) => toItem(r.track, r.added_at)).filter((x): x is LibraryItem => x !== null);
    },

    async track(id: string): Promise<LibraryItem | null> {
      try {
        return toItem(await call<RawTrack>(`/tracks/${encodeURIComponent(id)}`), null);
      } catch (e) {
        if (e instanceof SourceError && (e.status === 404 || e.status === 400)) return null;
        throw e;
      }
    },

    async likedCount(): Promise<number> {
      return (await call<{ total: number }>("/me/tracks?limit=1")).total;
    },

    /** Create a private playlist and fill it; returns its Spotify URL. */
    async createPlaylist(name: string, description: string, trackIds: string[]): Promise<string> {
      const p = await call<{ id: string; external_urls: { spotify: string } }>("/me/playlists", {
        method: "POST",
        body: JSON.stringify({ name, description, public: false }),
      });
      for (let i = 0; i < trackIds.length; i += 100) {
        await call(`/playlists/${p.id}/items`, {
          method: "POST",
          body: JSON.stringify({ uris: trackIds.slice(i, i + 100).map((id) => `spotify:track:${id}`) }),
        });
      }
      return p.external_urls.spotify;
    },
  };
}

