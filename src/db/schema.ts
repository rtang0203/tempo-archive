import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const confidence = pgEnum("bpm_confidence", ["high", "medium", "low", "unavailable"]);
export const visibility = pgEnum("visibility", ["public", "unlisted"]);
export const source = pgEnum("source", ["essentia", "reccobeats", "deezer"]);
export const lookupStatus = pgEnum("lookup_status", ["hit", "miss"]);

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  spotifyUserId: text("spotify_user_id").notNull().unique(),
  displayName: text("display_name"),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  /** Cached so the web app and worker share one token and don't race on PKCE refresh-token rotation. */
  accessTokenEnc: text("access_token_enc"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * One row per song. From Spotify only the ID and ISRC are kept (Developer Terms);
 * title/artists/artwork/genres come from Deezer and stay null when Deezer has no match.
 */
export const tracks = pgTable(
  "tracks",
  {
    id: uuid().primaryKey().defaultRandom(),
    spotifyId: text("spotify_id").notNull().unique(),
    isrc: text(),
    deezerId: bigint("deezer_id", { mode: "number" }),
    title: text(),
    artists: text().array(),
    durationMs: integer("duration_ms"),
    artworkUrl: text("artwork_url"),
    genres: text().array().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("tracks_isrc_idx").on(t.isrc)],
);

/**
 * Records that a source was asked about a track at a given source version, so
 * misses are cached too. Transient errors write nothing and are retried.
 */
export const sourceLookups = pgTable(
  "source_lookups",
  {
    trackId: uuid("track_id").notNull().references(() => tracks.id, { onDelete: "cascade" }),
    source: source().notNull(),
    sourceVersion: integer("source_version").notNull(),
    status: lookupStatus().notNull(),
    lookedUpAt: timestamp("looked_up_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.trackId, t.source, t.sourceVersion] })],
);

/** Every raw value from every source, kept so rules can be recomputed offline. */
export const featureEstimates = pgTable(
  "feature_estimates",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    trackId: uuid("track_id").notNull().references(() => tracks.id, { onDelete: "cascade" }),
    source: source().notNull(),
    sourceVersion: integer("source_version").notNull(),
    feature: text().$type<"bpm" | "bpm_confidence" | "energy" | "danceability" | "key">().notNull(),
    value: doublePrecision(),
    valueText: text("value_text"),
    createdAt: createdAt(),
  },
  (t) => [unique("feature_estimates_once").on(t.trackId, t.source, t.sourceVersion, t.feature)],
);

/** Resolved values the UI reads. Energy, danceability, key: Essentia only. */
export const trackFeatures = pgTable("track_features", {
  trackId: uuid("track_id").primaryKey().references(() => tracks.id, { onDelete: "cascade" }),
  bpm: doublePrecision(),
  bpmFolded: doublePrecision("bpm_folded"),
  bpmConfidence: confidence("bpm_confidence").notNull(),
  ambiguousFeel: boolean("ambiguous_feel").notNull().default(false),
  bpmAlt: doublePrecision("bpm_alt"),
  energy: doublePrecision(),
  danceability: doublePrecision(),
  key: text(),
  camelot: text(),
  rulesVersion: integer("rules_version").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bpmFlags = pgTable("bpm_flags", {
  id: bigserial({ mode: "number" }).primaryKey(),
  trackId: uuid("track_id").notNull().references(() => tracks.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

export const collections = pgTable("collections", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  title: text().notNull(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  spotifyPlaylistId: text("spotify_playlist_id"),
  visibility: visibility().notNull().default("public"),
  importStatus: text("import_status").notNull().default("pending"),
  createdAt: createdAt(),
});

export const collectionTracks = pgTable(
  "collection_tracks",
  {
    collectionId: uuid("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
    trackId: uuid("track_id").notNull().references(() => tracks.id),
    position: integer().notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.position] })],
);

export const importJobs = pgTable("import_jobs", {
  id: uuid().primaryKey().defaultRandom(),
  collectionId: uuid("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
  state: text().notNull().default("queued"),
  total: integer().notNull().default(0),
  done: integer().notNull().default(0),
  failed: integer().notNull().default(0),
  error: text(),
  createdAt: createdAt(),
});
