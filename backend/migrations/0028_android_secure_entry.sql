DROP INDEX "login_request_pending_idx";--> statement-breakpoint
ALTER TABLE "login_flows" ADD COLUMN "destination" jsonb DEFAULT '{"kind":"browser"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "login_requests" ADD COLUMN "destination" jsonb DEFAULT '{"kind":"browser"}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "login_request_pending_idx" ON "login_requests" USING btree ("task_id","origin","kind","destination") WHERE "login_requests"."status" in ('pending','updating','failed');