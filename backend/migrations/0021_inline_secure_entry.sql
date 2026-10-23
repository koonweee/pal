ALTER TABLE "login_requests" DROP CONSTRAINT "login_request_status";--> statement-breakpoint
DROP INDEX "login_request_pending_idx";--> statement-breakpoint
ALTER TABLE "login_requests" ADD COLUMN "inspection_id" uuid;--> statement-breakpoint
ALTER TABLE "login_requests" ADD COLUMN "card_id" uuid;--> statement-breakpoint
UPDATE "login_requests" SET "card_id" = "id";--> statement-breakpoint
ALTER TABLE "login_requests" ALTER COLUMN "card_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "login_requests" ADD COLUMN "recovery_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "login_requests" ADD COLUMN "recovery_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "login_requests" ADD CONSTRAINT "login_requests_inspection_id_login_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."login_inspections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_request_card_idx" ON "login_requests" USING btree ("card_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "login_request_pending_idx" ON "login_requests" USING btree ("task_id","origin","kind") WHERE "login_requests"."status" in ('pending','updating','failed');--> statement-breakpoint
ALTER TABLE "login_requests" ADD CONSTRAINT "login_request_status" CHECK ("login_requests"."status" in ('pending','saved','filled','cancelled','updating','failed'));