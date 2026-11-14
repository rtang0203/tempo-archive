import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CollectionApp } from "@/components/collection/CollectionApp";
import { getCollection } from "@/server/collections";
import { db } from "@/server/context";
import { sessionUser } from "@/server/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = await getCollection(db(), (await params).slug);
  if (!c) return {};
  return {
    title: `${c.title} · Tempo Atlas`,
    description: `${c.tracks.length} tracks laid out by tempo.`,
    // Unlisted collections stay out of search engines.
    robots: c.visibility === "unlisted" ? { index: false, follow: false } : undefined,
  };
}

export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const [c, user] = await Promise.all([getCollection(db(), (await params).slug), sessionUser()]);
  if (!c) notFound();
  return <CollectionApp initial={c} viewer={{ loggedIn: !!user, isOwner: user?.id === c.ownerId }} />;
}
