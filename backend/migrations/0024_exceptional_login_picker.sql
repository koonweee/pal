ALTER TABLE "login_requests" DROP CONSTRAINT "login_request_status";--> statement-breakpoint
ALTER TABLE "login_requests" ADD COLUMN "choose_account" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "login_requests" ADD CONSTRAINT "login_request_status" CHECK ("login_requests"."status" in ('pending','saved','selected','filled','cancelled','updating','failed'));