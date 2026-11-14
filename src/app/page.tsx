import Link from "next/link";
import type { PlaylistSummary } from "@/adapters/spotify";
import { MiniHistogram } from "@/components/MiniHistogram";
import { type CollectionCard, publicCollections, userCollections } from "@/server/collections";
import { db } from "@/server/context";
import { sessionUser } from "@/server/session";
import { libraryFor } from "@/server/users";
import { disconnect, logout, startImport } from "./actions";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const user = await sessionUser();
  const publicCards = await publicCollections(db());

  let library: { playlists: PlaylistSummary[]; liked: number } | null = null;
  let libraryError: string | null = null;
  let mine: CollectionCard[] = [];
  if (user) {
    try {
      const lib = await libraryFor(db(), user.id);
      const [playlists, liked] = await Promise.all([lib.playlists(user.spotifyUserId), lib.likedCount()]);
      library = { playlists, liked };
    } catch (e) {
      libraryError = e instanceof Error ? e.message : String(e);
    }
    mine = await userCollections(db(), user.id);
  }
  const owned = library?.playlists.filter((p) => p.owned) ?? [];
  const followed = library?.playlists.filter((p) => !p.owned) ?? [];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-10 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Tempo Atlas</h1>
        {user && (
          <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
            <span>{user.displayName ?? user.spotifyUserId}</span>
            <form action={logout}>
              <button className="hover:text-[var(--fg)]">Log out</button>
            </form>
          </div>
        )}
      </header>

      {error && (
        <p className="mb-6 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
          Spotify login didn&apos;t complete ({error}). Try again.
        </p>
      )}

      {!user ? (
        <section className="mb-14 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-8 text-center">
          <p className="mb-6 text-lg">Lay out your music by tempo. Find everything that moves at the same speed.</p>
          <a
            href="/login"
            className="inline-block rounded-full bg-[#1db954] px-6 py-3 font-semibold text-black hover:brightness-110"
          >
            Connect Spotify
          </a>
        </section>
      ) : (
        <section className="mb-14">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-[var(--muted)]">Import from Spotify</h2>
          {libraryError ? (
            <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
              Couldn&apos;t load your Spotify library: {libraryError}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)]">
              <PickerRow title="Liked Songs" subtitle={`${library?.liked ?? 0} tracks · unlisted by default`} kind="liked" />
              {owned.map((p) => (
                <PickerRow key={p.id} title={p.name} subtitle={`${p.trackCount} tracks`} kind="playlist" playlist={p} />
              ))}
              {followed.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-4 py-3 opacity-45">
                  <div>
                    <div>{p.name}</div>
                    <div className="text-xs text-[var(--muted)]">
                      by {p.ownerName} · Spotify only lets us read playlists you own; save a copy first.
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {mine.length > 0 && <CardGrid title="Your collections" cards={mine} />}
      <CardGrid title="Recently shared" cards={publicCards} empty="No public collections yet." />

      {user && (
        <form action={disconnect} className="mt-16 text-sm text-[var(--muted)]">
          <button className="underline hover:text-red-400">Disconnect Spotify and delete my collections</button>
        </form>
      )}
    </main>
  );
}

function PickerRow(props: { title: string; subtitle: string; kind: "liked" | "playlist"; playlist?: PlaylistSummary }) {
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="truncate">{props.title}</div>
        <div className="text-xs text-[var(--muted)]">{props.subtitle}</div>
      </div>
      <form action={startImport}>
        <input type="hidden" name="kind" value={props.kind} />
        {props.playlist && (
          <>
            <input type="hidden" name="playlistId" value={props.playlist.id} />
            <input type="hidden" name="title" value={props.playlist.name} />
          </>
        )}
        <button className="rounded-full border border-[var(--line)] px-4 py-1.5 text-sm hover:border-[var(--fg)]">
          Import
        </button>
      </form>
    </li>
  );
}

function CardGrid({ title, cards, empty }: { title: string; cards: CollectionCard[]; empty?: string }) {
  return (
    <section className="mb-12">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-[var(--muted)]">{title}</h2>
      {cards.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{empty}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {cards.map((c) => (
            <Link
              key={c.slug}
              href={`/c/${c.slug}`}
              className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 hover:border-[var(--muted)]"
            >
              <MiniHistogram lanes={c.histogram} />
              <div className="mt-2 truncate text-sm font-medium">{c.title}</div>
              <div className="text-xs text-[var(--muted)]">
                {c.trackCount} tracks{c.visibility === "unlisted" ? " · unlisted" : ""}
                {c.importStatus === "importing" ? " · importing…" : ""}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
