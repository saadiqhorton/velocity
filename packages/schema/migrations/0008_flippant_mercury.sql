CREATE TABLE "import_reference_repair_targets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"repair_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"provenance_key" text NOT NULL,
	"source_external_id" text NOT NULL,
	"expected_hash" text NOT NULL,
	"before_md" text NOT NULL,
	"after_md" text NOT NULL,
	"context" jsonb NOT NULL,
	"reference_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_reference_repairs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"created_by" uuid,
	"status" text DEFAULT 'scanning' NOT NULL,
	"preview_version" integer DEFAULT 1 NOT NULL,
	"preview_hash" text DEFAULT '' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_reference_repair_targets" ADD CONSTRAINT "import_reference_repair_targets_repair_id_import_reference_repairs_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."import_reference_repairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_reference_repairs" ADD CONSTRAINT "import_reference_repairs_run_id_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_reference_repairs" ADD CONSTRAINT "import_reference_repairs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_reference_repair_targets_uq" ON "import_reference_repair_targets" USING btree ("repair_id","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "import_reference_repair_targets_pending_idx" ON "import_reference_repair_targets" USING btree ("repair_id","status");--> statement-breakpoint
CREATE INDEX "import_reference_repairs_run_idx" ON "import_reference_repairs" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_reference_repairs_active_uq" ON "import_reference_repairs" USING btree ("run_id") WHERE "import_reference_repairs"."status" in ('scanning','preview','applying');