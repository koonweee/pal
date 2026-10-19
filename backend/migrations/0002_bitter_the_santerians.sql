ALTER TABLE "messages" DROP CONSTRAINT "main_message_visibility";--> statement-breakpoint
DROP INDEX "messages_main_idx";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "phase" text;--> statement-breakpoint
CREATE INDEX "messages_main_idx" ON "messages" USING btree ("sequence" DESC NULLS LAST) WHERE "messages"."task_id" is null or ("messages"."role" = 'assistant' and "messages"."phase" = 'final_answer');--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "show_in_main_chat";--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "message_phase" CHECK ("messages"."phase" is null or ("messages"."role" = 'assistant' and "messages"."phase" in ('commentary', 'final_answer')));