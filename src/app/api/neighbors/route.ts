import { type NextRequest, NextResponse } from "next/server";
import { globalNeighbors } from "@/server/collections";
import { db } from "@/server/context";

/** "All of Tempo Atlas" scope: neighbors among public collections. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const bpm = Number(p.get("bpm"));
  const tol = Number(p.get("tol") ?? 3);
  if (!(bpm > 0) || !(tol > 0) || tol > 8) return NextResponse.json({ error: "bad bpm or tol" }, { status: 400 });
  const energy = p.get("energy");
  const result = await globalNeighbors(
    db(),
    {
      bpm,
      energy: energy ? Number(energy) : null,
      genres: p.getAll("genre"),
      trackId: p.get("trackId") ?? undefined,
    },
    tol,
    p.get("fold") !== "0",
  );
  return NextResponse.json(result);
}
