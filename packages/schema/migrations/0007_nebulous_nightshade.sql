CREATE TABLE "github_app" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"app_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"client_id" text DEFAULT '' NOT NULL,
	"client_secret_encrypted" text NOT NULL,
	"private_key_encrypted" text NOT NULL,
	"webhook_secret_encrypted" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_app_singleton" CHECK ("github_app"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "github_app" ADD CONSTRAINT "github_app_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;