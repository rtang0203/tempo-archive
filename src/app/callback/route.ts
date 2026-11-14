import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { exchangeCode, spotifyLibrary } from "@/adapters/spotify";
import { db, spotifyConfig } from "@/server/context";
import { unsign } from "@/server/crypto";
import { setSession } from "@/server/session";
import { upsertUser } from "@/server/users";

export async function GET(req: NextRequest) {
  const { clientId, redirectUri } = spotifyConfig();
  const params = req.nextUrl.searchParams;
  const jar = await cookies();
  const saved = unsign(jar.get("ta_oauth")?.value);
  jar.delete({ name: "ta_oauth", path: "/callback" });

  const [state, verifier] = saved?.split(":") ?? [];
  const code = params.get("code");
  if (params.get("error") || !code || !state || !verifier || params.get("state") !== state) {
    redirect(`/?error=${encodeURIComponent(params.get("error") ?? "login_failed")}`);
  }

  const tokens = await exchangeCode(clientId, code, redirectUri, verifier);
  const me = await spotifyLibrary(tokens.accessToken).me();
  const userId = await upsertUser(db(), me.id, me.display_name, tokens);
  await setSession(userId);
  redirect("/");
}
