ALTER TABLE "login_requests" DROP CONSTRAINT "login_request_status";--> statement-breakpoint
DROP INDEX "login_request_pending_idx";--> statement-breakpoint
ALTER TABLE "login_requests" ADD COLUMN "kind" text DEFAULT 'credentials' NOT NULL;--> statement-breakpoint
ALTER TABLE "login_requests" ADD COLUMN "target_ref" text;--> statement-breakpoint
ALTER TABLE "login_requests" ADD COLUMN "worker_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "login_request_pending_idx" ON "login_requests" USING btree ("task_id","origin","kind") WHERE "login_requests"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "login_requests" ADD CONSTRAINT "login_request_kind" CHECK ("login_requests"."kind" in ('credentials','code'));--> statement-breakpoint
ALTER TABLE "login_requests" ADD CONSTRAINT "login_request_status" CHECK ("login_requests"."status" in ('pending','saved','filled','cancelled'));
--> statement-breakpoint
UPDATE login_inspections SET targets = (
  SELECT coalesce(jsonb_agg(CASE WHEN entry ? 'loginRef' THEN (entry - 'loginRef') || jsonb_build_object('targetRef', entry->'loginRef') ELSE entry END), '[]'::jsonb)
  FROM jsonb_array_elements(targets) AS entry
) WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(targets) AS entry WHERE entry ? 'loginRef');
