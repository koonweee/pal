ALTER TABLE "messages" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "delivery_channels" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "notify" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "messages" SET "source" = 'api' WHERE "role" = 'user';--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "message_source" CHECK (("messages"."role" = 'user' and "messages"."source" is not null and "messages"."source" in ('api', 'web', 'ios', 'telegram')) or ("messages"."role" = 'assistant' and "messages"."source" is null));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "message_notify" CHECK (not "messages"."notify" or ("messages"."role" = 'assistant' and "messages"."phase" is not null and "messages"."phase" = 'final_answer'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "message_delivery_channels" CHECK (jsonb_typeof("messages"."delivery_channels") = 'array' and "messages"."delivery_channels" <@ '["telegram", "ios_push", "web_push"]'::jsonb and ("messages"."role" = 'assistant' or "messages"."delivery_channels" = '[]'::jsonb));