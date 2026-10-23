CREATE TABLE "login_flows" (
	"owner" text PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"account_id" text NOT NULL,
	"keep_me_signed_in" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_sites" (
	"origin" text PRIMARY KEY NOT NULL,
	"last_account_id" text,
	"keep_me_signed_in" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_requests" ADD COLUMN "keep_me_signed_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "login_flows" ADD CONSTRAINT "login_flows_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;