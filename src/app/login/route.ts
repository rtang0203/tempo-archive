import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authorizeUrl, pkcePair } from "@/adapters/spotify";
import { spotifyConfig } from "@/server/context";
import { sign } from "@/server/crypto";

/** Start Spotify Authorization Code + PKCE; the verifier and state ride in a short-lived signed cookie. */
export async function GET() {
  const { clientId, redirectUri } = spotifyConfig();
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString("base64url");
  (await cookies()).set("ta_oauth", sign(`${state}:${verifier}`), {
    httpOnly: true,
    sameSite: "lax",
    path: "/callback",
    maxAge: 600,
  });
  redirect(authorizeUrl(clientId, redirectUri, state, challenge));
}
