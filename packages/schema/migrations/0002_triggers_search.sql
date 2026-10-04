-- Self-referencing foreign keys (kept out of the Drizzle table definitions to avoid circular types).
ALTER TABLE "issues" ADD CONSTRAINT "issues_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "issues"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_moved_to_fk" FOREIGN KEY ("moved_to_issue_id") REFERENCES "issues"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_parent_fk" FOREIGN KEY ("parent_label_id") REFERENCES "labels"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- Realtime signalling (SPEC §5.5): every outbox insert NOTIFYs the app process, which drains
-- new rows and fans them out over GraphQL subscriptions and pg-boss jobs. Payload = row id.
CREATE OR REPLACE FUNCTION velocity_outbox_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('velocity_events', NEW.id::text);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER event_outbox_notify AFTER INSERT ON "event_outbox"
  FOR EACH ROW EXECUTE FUNCTION velocity_outbox_notify();
--> statement-breakpoint

-- Full-text search (SPEC §5.7): title weight A, description + comments weight C.
CREATE OR REPLACE FUNCTION velocity_issue_search_vector(p_issue_id uuid, p_title text, p_description text)
RETURNS tsvector LANGUAGE sql STABLE AS $$
  SELECT
    setweight(to_tsvector('english', coalesce(p_title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(p_title, '')), 'A') ||
    setweight(to_tsvector('english', left(coalesce(p_description, ''), 100000)), 'C') ||
    setweight(to_tsvector('english', coalesce((
      SELECT left(string_agg(c.body_md, E'\n' ORDER BY c.created_at), 200000)
      FROM comments c
      WHERE c.issue_id = p_issue_id AND c.deleted_at IS NULL
    ), '')), 'C');
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION velocity_issues_search_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := velocity_issue_search_vector(NEW.id, NEW.title, NEW.description_md);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER issues_search_update BEFORE INSERT OR UPDATE OF title, description_md ON "issues"
  FOR EACH ROW EXECUTE FUNCTION velocity_issues_search_trigger();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION velocity_comments_search_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid := COALESCE(NEW.issue_id, OLD.issue_id);
BEGIN
  UPDATE issues SET search_vector = velocity_issue_search_vector(id, title, description_md) WHERE id = target;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER comments_search_update AFTER INSERT OR UPDATE OF body_md, deleted_at OR DELETE ON "comments"
  FOR EACH ROW EXECUTE FUNCTION velocity_comments_search_trigger();
--> statement-breakpoint

-- Trigram indexes: fuzzy title matching + names for search across entities.
CREATE INDEX "issues_title_trgm_idx" ON "issues" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "projects_name_trgm_idx" ON "projects" USING gin ("name" gin_trgm_ops);
