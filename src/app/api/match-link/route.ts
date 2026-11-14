import { NextResponse } from "next/server";
import { getTrack } from "@/server/collections";
import { db, trackSources } from "@/server/context";
import { sessionUser } from "@/server/session";
import { libraryFor } from "@/server/users";
import { ensureTracks } from "@/tracks/ensure";

const TRACK_LINK = /(?:open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/;

/** Match box: analyze any pasted Spotify track (logged-in only; goes through the shared cache). */
export async function POST(req: Request) {
  const u = await sessionUser();
  if (!u) return NextResponse.json({ error: "log in to paste links" }, { status: 401 });
  const { url } = (await req.json()) as { url?: string };
  const id = url?.match(TRACK_LINK)?.[1];
  if (!id) return NextResponse.json({ error: "not a Spotify track link" }, { status: 400 });

  const item = await (await libraryFor(db(), u.id)).track(id);
  if (!item) return NextResponse.json({ error: "Spotify doesn't know that track" }, { status: 404 });
  const [outcome] = await ensureTracks(db(), trackSources(), [item]);
  const track = await getTrack(db(), outcome!.trackId);
  // Title/artists from Spotify are returned for display only, never stored.
  return NextResponse.json({ ...track, title: track?.title ?? item.title, artists: track?.artists.length ? track.artists : item.artists });
}
