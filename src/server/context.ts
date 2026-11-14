import { PgBoss } from "pg-boss";
import { analyzerClient } from "../adapters/analyzer";
import { deezer } from "../adapters/deezer";
import { itunes } from "../adapters/itunes";
import { reccobeats } from "../adapters/reccobeats";
import type { TrackSources } from "../adapters/types";
import { connect, type Db } from "../db/client";

export const IMPORT_QUEUE = "import-collection";

export interface ImportJobData {
  jobId: string;
}

// Next.js dev reloads modules; keep one pool/boss per process.
const g = globalThis as unknown as { __db?: Db; __boss?: Promise<PgBoss> };

export function db(): Db {
  g.__db ??= connect();
  return g.__db;
}

export function boss(): Promise<PgBoss> {
  g.__boss ??= (async () => {
    const b = new PgBoss(process.env.DATABASE_URL!);
    b.on("error", (e) => console.error("pg-boss", e));
    await b.start();
    await b.createQueue(IMPORT_QUEUE);
    return b;
  })();
  return g.__boss;
}

export function trackSources(): TrackSources {
  return {
    deezer: deezer(),
    reccobeats: reccobeats(),
    previews: itunes(),
    analyzer: analyzerClient(process.env.ANALYZER_URL ?? "http://127.0.0.1:8000"),
  };
}

export function spotifyConfig() {
  const clientId = process.env.CLIENT_ID;
  const appUrl = process.env.APP_URL;
  if (!clientId || !appUrl) throw new Error("CLIENT_ID and APP_URL must be set");
  return { clientId, redirectUri: `${appUrl}/callback`, appUrl };
}
