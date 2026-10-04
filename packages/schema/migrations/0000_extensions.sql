-- Extensions required by the data model (SPEC §5.7, §7.6): citext for case-insensitive
-- usernames/emails, pg_trgm for title trigram search and identifier fast-path.
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
