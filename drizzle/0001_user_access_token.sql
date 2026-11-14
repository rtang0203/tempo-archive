ALTER TABLE "users" ALTER COLUMN "refresh_token_enc" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "access_token_enc" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "access_token_expires_at" timestamp with time zone;