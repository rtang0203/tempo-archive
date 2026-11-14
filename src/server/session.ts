import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { users } from "../db/schema";
import { db } from "./context";
import { sign, unsign } from "./crypto";

const COOKIE = "ta_session";
const MAX_AGE = 60 * 60 * 24 * 30;

export interface SessionUser {
  id: string;
  spotifyUserId: string;
  displayName: string | null;
}

export async function setSession(userId: string): Promise<void> {
  (await cookies()).set(COOKIE, sign(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.APP_URL?.startsWith("https://") ?? false,
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function sessionUser(): Promise<SessionUser | null> {
  const id = unsign((await cookies()).get(COOKIE)?.value);
  if (!id) return null;
  const [u] = await db()
    .select({ id: users.id, spotifyUserId: users.spotifyUserId, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, id));
  return u ?? null;
}
