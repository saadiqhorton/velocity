CREATE TABLE "team_key_aliases" (
	"key" text PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_key_aliases_format" CHECK ("team_key_aliases"."key" ~ '^[A-Z][A-Z0-9]{0,9}$')
);
--> statement-breakpoint
CREATE INDEX "team_key_aliases_team_idx" ON "team_key_aliases" USING btree ("team_id");
--> statement-breakpoint
-- Existing identifiers become the first aliases during upgrade.
INSERT INTO "team_key_aliases" ("key", "team_id") SELECT "key", "id" FROM "teams";
