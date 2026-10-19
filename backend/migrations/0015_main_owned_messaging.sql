ALTER TABLE "messages" DROP CONSTRAINT "message_notification_destinations";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "message_destinations";--> statement-breakpoint
DROP INDEX "delivery_job_message_destination_idx";--> statement-breakpoint
DROP INDEX "messages_main_idx";--> statement-breakpoint
DROP INDEX "notification_intent_message_destination_idx";--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD COLUMN "message_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD COLUMN "reaction" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "main_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "messages" SET "main_visible" = true WHERE "task_id" IS NOT NULL AND "role" = 'assistant' AND "phase" = 'final_answer';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reaction" text;--> statement-breakpoint
ALTER TABLE "notification_intents" ADD COLUMN "message_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_intents" ADD COLUMN "reaction" text;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_job_message_destination_idx" ON "delivery_jobs" USING btree ("message_id","destination_id","message_version");--> statement-breakpoint
CREATE INDEX "messages_main_idx" ON "messages" USING btree ("sequence" DESC NULLS LAST) WHERE "messages"."task_id" is null or "messages"."main_visible";--> statement-breakpoint
CREATE UNIQUE INDEX "notification_intent_message_destination_idx" ON "notification_intents" USING btree ("message_id","destination_id","message_version");--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "participant_destination_ids";--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "message_notification_destinations" CHECK (jsonb_typeof("messages"."notification_destination_ids") = 'array' and "messages"."notification_destination_ids" <@ "messages"."delivery_destination_ids" and ("messages"."notification_destination_ids" = '[]'::jsonb or "messages"."role" = 'assistant'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "message_destinations" CHECK (jsonb_typeof("messages"."delivery_destination_ids") = 'array' and ("messages"."role" = 'assistant' or ("messages"."delivery_destination_ids" = '[]'::jsonb and "messages"."notification_destination_ids" = '[]'::jsonb)));