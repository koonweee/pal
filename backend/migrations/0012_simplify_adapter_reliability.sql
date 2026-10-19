ALTER TABLE "agent_submissions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "agent_submissions" CASCADE;--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "message_notify";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "message_notification_destinations";--> statement-breakpoint
ALTER TABLE "delivery_jobs" DROP COLUMN "accepted_references";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "notify";--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "message_notification_destinations" CHECK (jsonb_typeof("messages"."notification_destination_ids") = 'array' and "messages"."notification_destination_ids" <@ "messages"."delivery_destination_ids" and ("messages"."notification_destination_ids" = '[]'::jsonb or ("messages"."role" = 'assistant' and "messages"."phase" = 'final_answer')));
