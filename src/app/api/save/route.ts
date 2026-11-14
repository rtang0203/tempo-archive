import { NextResponse } from "next/server";
import { SourceError } from "@/adapters/http";
import { db } from "@/server/context";
import { sessionUser } from "@/server/session";
import { libraryFor } from "@/server/users";

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

/** Save a selection or neighbor list as a new private playlist in the viewer's Spotify account. */
export async function POST(req: Request) {
  const u = await sessionUser();
  if (!u) return NextResponse.json({ error: "log in with Spotify to save" }, { status: 401 });
  const { name, spotifyIds } = (await req.json()) as { name?: string; spotifyIds?: string[] };
  const ids = (spotifyIds ?? []).filter((id) => SPOTIFY_ID.test(id));
  if (!name?.trim() || ids.length === 0 || ids.length > 1000) {
    return NextResponse.json({ error: "need a name and 1–1000 tracks" }, { status: 400 });
  }
  try {
    const lib = await libraryFor(db(), u.id);
    const url = await lib.createPlaylist(name.trim().slice(0, 100), "Made with Tempo Atlas", ids);
    return NextResponse.json({ url });
  } catch (e) {
    const status = e instanceof SourceError ? (e.status ?? 502) : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "save failed" }, { status: status >= 500 ? 502 : status });
  }
}
