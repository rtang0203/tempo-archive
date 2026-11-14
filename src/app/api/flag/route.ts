import { NextResponse } from "next/server";
import { bpmFlags } from "@/db/schema";
import { getTrack } from "@/server/collections";
import { db } from "@/server/context";
import { sessionUser } from "@/server/session";
import { recomputeFeatures } from "@/tracks/ensure";

/** "BPM looks wrong": record the flag and re-run the agreement rule, which marks it low confidence. */
export async function POST(req: Request) {
  const u = await sessionUser();
  if (!u) return NextResponse.json({ error: "log in to flag" }, { status: 401 });
  const { trackId } = (await req.json()) as { trackId?: string };
  if (!trackId || !(await getTrack(db(), trackId))) return NextResponse.json({ error: "unknown track" }, { status: 404 });
  await db().insert(bpmFlags).values({ trackId, userId: u.id });
  await recomputeFeatures(db(), [trackId]);
  return NextResponse.json(await getTrack(db(), trackId));
}
