"use server";

import { redirect } from "next/navigation";
import { setVisibility } from "@/server/collections";
import { boss, db, IMPORT_QUEUE } from "@/server/context";
import { createImport, type ImportSource } from "@/server/imports";
import { clearSession, sessionUser } from "@/server/session";
import { deleteUser } from "@/server/users";

async function requireUser() {
  const u = await sessionUser();
  if (!u) redirect("/login");
  return u;
}

export async function startImport(form: FormData) {
  const u = await requireUser();
  const kind = form.get("kind");
  const source: ImportSource =
    kind === "liked"
      ? { kind: "liked" }
      : { kind: "playlist", playlistId: String(form.get("playlistId")), title: String(form.get("title")) };
  const { jobId, slug } = await createImport(db(), u.id, source);
  await (await boss()).send(IMPORT_QUEUE, { jobId }, { retryLimit: 2, retryDelay: 30 });
  redirect(`/c/${slug}`);
}

export async function changeVisibility(slug: string, visibility: "public" | "unlisted") {
  const u = await requireUser();
  await setVisibility(db(), u.id, slug, visibility);
}

/** Disconnect: delete the account and every collection it imported. */
export async function disconnect() {
  const u = await requireUser();
  await deleteUser(db(), u.id);
  await clearSession();
  redirect("/");
}

export async function logout() {
  await clearSession();
  redirect("/");
}
