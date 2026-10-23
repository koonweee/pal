CREATE TABLE "login_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"task_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"targets" jsonb NOT NULL,
	"image" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"task_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"account_id" text,
	"notified_at" timestamp with time zone,
	CONSTRAINT "login_request_status" CHECK ("login_requests"."status" in ('pending','saved','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "login_inspections" ADD CONSTRAINT "login_inspections_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_requests" ADD CONSTRAINT "login_requests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "login_request_pending_idx" ON "login_requests" USING btree ("task_id","origin") WHERE "login_requests"."status" = 'pending';