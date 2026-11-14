CREATE TYPE "public"."bpm_confidence" AS ENUM('high', 'medium', 'low', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."lookup_status" AS ENUM('hit', 'miss');--> statement-breakpoint
CREATE TYPE "public"."source" AS ENUM('essentia', 'reccobeats', 'deezer');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('public', 'unlisted');--> statement-breakpoint
CREATE TABLE "bpm_flags" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"track_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_tracks" (
	"collection_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp with time zone,
	CONSTRAINT "collection_tracks_collection_id_position_pk" PRIMARY KEY("collection_id","position")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"spotify_playlist_id" text,
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"import_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "feature_estimates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"track_id" uuid NOT NULL,
	"source" "source" NOT NULL,
	"source_version" integer NOT NULL,
	"feature" text NOT NULL,
	"value" double precision,
	"value_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_estimates_once" UNIQUE("track_id","source","source_version","feature")
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_lookups" (
	"track_id" uuid NOT NULL,
	"source" "source" NOT NULL,
	"source_version" integer NOT NULL,
	"status" "lookup_status" NOT NULL,
	"looked_up_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_lookups_track_id_source_source_version_pk" PRIMARY KEY("track_id","source","source_version")
);
--> statement-breakpoint
CREATE TABLE "track_features" (
	"track_id" uuid PRIMARY KEY NOT NULL,
	"bpm" double precision,
	"bpm_folded" double precision,
	"bpm_confidence" "bpm_confidence" NOT NULL,
	"ambiguous_feel" boolean DEFAULT false NOT NULL,
	"bpm_alt" double precision,
	"energy" double precision,
	"danceability" double precision,
	"key" text,
	"camelot" text,
	"rules_version" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spotify_id" text NOT NULL,
	"isrc" text,
	"deezer_id" bigint,
	"title" text,
	"artists" text[],
	"duration_ms" integer,
	"artwork_url" text,
	"genres" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracks_spotify_id_unique" UNIQUE("spotify_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spotify_user_id" text NOT NULL,
	"display_name" text,
	"refresh_token_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_spotify_user_id_unique" UNIQUE("spotify_user_id")
);
--> statement-breakpoint
ALTER TABLE "bpm_flags" ADD CONSTRAINT "bpm_flags_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bpm_flags" ADD CONSTRAINT "bpm_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_tracks" ADD CONSTRAINT "collection_tracks_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_tracks" ADD CONSTRAINT "collection_tracks_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_estimates" ADD CONSTRAINT "feature_estimates_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_lookups" ADD CONSTRAINT "source_lookups_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_features" ADD CONSTRAINT "track_features_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tracks_isrc_idx" ON "tracks" USING btree ("isrc");