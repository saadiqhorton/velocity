ALTER TABLE "workspace" ADD COLUMN "features" jsonb DEFAULT '{"cycles":false,"estimates":false,"insights":false,"members":false}'::jsonb NOT NULL;
--> statement-breakpoint
-- Preserve the visible features of installations that already have a workspace.
-- The column default remains solo mode for workspaces created after this migration.
UPDATE "workspace" SET "features" = '{"cycles":true,"estimates":true,"insights":true,"members":true}'::jsonb;
