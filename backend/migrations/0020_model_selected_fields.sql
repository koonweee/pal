ALTER TABLE "login_inspections" RENAME COLUMN "targets" TO "metadata";--> statement-breakpoint
ALTER TABLE "login_requests" ADD COLUMN "fields" jsonb;--> statement-breakpoint
ALTER TABLE "login_requests" DROP COLUMN "target_ref";
--> statement-breakpoint
UPDATE login_inspections SET metadata = jsonb_build_object('targets', metadata);
--> statement-breakpoint
UPDATE login_requests SET status='cancelled' WHERE kind='code' AND status='pending';
