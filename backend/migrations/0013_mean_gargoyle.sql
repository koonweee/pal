CREATE TABLE "notification_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"message_id" uuid NOT NULL,
	"destination_id" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"error_code" text,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_intent_state" CHECK ("notification_intents"."state" in ('pending', 'sending', 'accepted', 'failed', 'uncertain', 'cancelled')),
	CONSTRAINT "notification_intent_attempts" CHECK ("notification_intents"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "native_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"destination_id" text NOT NULL,
	"provider" text NOT NULL,
	"token" text NOT NULL,
	"environment" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "native_installation_environment" CHECK ("native_installations"."environment" in ('development', 'production')),
	CONSTRAINT "native_installation_generation" CHECK ("native_installations"."generation" > 0)
);
--> statement-breakpoint
ALTER TABLE "notification_intents" ADD CONSTRAINT "notification_intents_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_intents" ADD CONSTRAINT "notification_intents_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_intent_message_destination_idx" ON "notification_intents" USING btree ("message_id","destination_id");--> statement-breakpoint
CREATE INDEX "notification_intent_dispatch_idx" ON "notification_intents" USING btree ("destination_id","state","next_attempt_at");