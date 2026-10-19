DROP INDEX "tasks_history_idx";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "last_activity_at" timestamp (3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "tasks"
SET "last_activity_at" = greatest(
	"tasks"."updated_at",
	coalesce(
		(SELECT max("messages"."created_at") FROM "messages" WHERE "messages"."task_id" = "tasks"."id"),
		"tasks"."created_at"
	)
);--> statement-breakpoint
CREATE INDEX "tasks_history_idx" ON "tasks" USING btree ("archived","last_activity_at" DESC NULLS LAST,"id" DESC NULLS LAST);
