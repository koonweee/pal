ALTER TABLE "messages" ADD COLUMN "suggested_replies" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "actions";