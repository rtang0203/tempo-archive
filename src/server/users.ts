import { eq } from "drizzle-orm";
import { refreshTokens, spotifyLibrary, type SpotifyLibrary, type SpotifyTokens } from "../adapters/spotify";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import { spotifyConfig } from "./context";
import { decrypt, encrypt } from "./crypto";

const EARLY_REFRESH_MS = 60_000;

export async function upsertUser(
  db: Db,
  spotifyUserId: string,
  displayName: string | null,
  tokens: SpotifyTokens,
): Promise<string> {
  if (!tokens.refreshToken) throw new Error("Spotify login returned no refresh token");
  const values = {
    displayName,
    refreshTokenEnc: encrypt(tokens.refreshToken),
    accessTokenEnc: encrypt(tokens.accessToken),
    accessTokenExpiresAt: tokens.expiresAt,
  };
  const [u] = await db
    .insert(users)
    .values({ spotifyUserId, ...values })
    .onConflictDoUpdate({ target: users.spotifyUserId, set: values })
    .returning({ id: users.id });
  return u!.id;
}

/**
 * A valid access token for the user. Refreshes under a row lock so the web app
 * and worker never both spend the same (possibly rotating) refresh token.
 */
export async function accessToken(db: Db, userId: string): Promise<string> {
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!u) throw new Error("user not found");
    if (u.accessTokenEnc && u.accessTokenExpiresAt && u.accessTokenExpiresAt.getTime() - EARLY_REFRESH_MS > Date.now()) {
      return decrypt(u.accessTokenEnc);
    }
    const t = await refreshTokens(spotifyConfig().clientId, decrypt(u.refreshTokenEnc));
    await tx
      .update(users)
      .set({
        accessTokenEnc: encrypt(t.accessToken),
        accessTokenExpiresAt: t.expiresAt,
        ...(t.refreshToken ? { refreshTokenEnc: encrypt(t.refreshToken) } : {}),
      })
      .where(eq(users.id, userId));
    return t.accessToken;
  });
}

export async function libraryFor(db: Db, userId: string): Promise<SpotifyLibrary> {
  return spotifyLibrary(await accessToken(db, userId));
}

/** Disconnect: removes the user and, by cascade, their collections, jobs, and flags. */
export async function deleteUser(db: Db, userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
  // Tracks stay as the shared cache: they hold only Deezer metadata and derived features.
}
