CREATE TABLE "import_warnings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"warning_key" text NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_reference_repair_targets" ADD COLUMN "mapping_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_warnings" ADD CONSTRAINT "import_warnings_run_id_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_warnings_run_key_uq" ON "import_warnings" USING btree ("run_id","warning_key");--> statement-breakpoint
CREATE INDEX "import_warnings_run_idx" ON "import_warnings" USING btree ("run_id");