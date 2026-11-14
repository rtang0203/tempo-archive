import { NextResponse } from "next/server";
import { getCollection } from "@/server/collections";
import { db } from "@/server/context";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const c = await getCollection(db(), (await params).slug);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(c, { headers: { "cache-control": "no-store" } });
}
