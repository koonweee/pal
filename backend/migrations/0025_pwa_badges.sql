ALTER TABLE "notification_intents" ADD COLUMN "sequence" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "web_push_installations" ADD COLUMN "seen_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_intents" ADD CONSTRAINT "notification_intents_sequence_unique" UNIQUE("sequence");
--> statement-breakpoint
CREATE INDEX "notification_intent_publication_idx" ON "notification_intents" ("destination_id", "sequence");
--> statement-breakpoint
UPDATE "web_push_installations" SET "seen_sequence" = (SELECT coalesce(max("sequence"), 0) FROM "notification_intents" WHERE "destination_id" = 'web');
