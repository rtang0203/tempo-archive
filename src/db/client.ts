import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/** Any Drizzle Postgres database over this schema (postgres-js in production, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function connect(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle(postgres(url), { schema });
}
