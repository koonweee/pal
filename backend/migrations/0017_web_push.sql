CREATE TABLE "web_push_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"error_code" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_push_delivery_state" CHECK ("web_push_deliveries"."state" in ('pending', 'sending', 'accepted', 'failed', 'uncertain', 'cancelled')),
	CONSTRAINT "web_push_delivery_attempts" CHECK ("web_push_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "web_push_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"activated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_push_installations_endpoint_unique" UNIQUE("endpoint"),
	CONSTRAINT "web_push_installation_generation" CHECK ("web_push_installations"."generation" > 0)
);
--> statement-breakpoint
ALTER TABLE "notification_intents" DROP CONSTRAINT "notification_intent_state";--> statement-breakpoint
ALTER TABLE "web_push_deliveries" ADD CONSTRAINT "web_push_deliveries_intent_id_notification_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."notification_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_push_deliveries" ADD CONSTRAINT "web_push_deliveries_installation_id_web_push_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."web_push_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "web_push_delivery_intent_installation_idx" ON "web_push_deliveries" USING btree ("intent_id","installation_id");--> statement-breakpoint
CREATE INDEX "web_push_delivery_dispatch_idx" ON "web_push_deliveries" USING btree ("state","next_attempt_at");--> statement-breakpoint
ALTER TABLE "notification_intents" ADD CONSTRAINT "notification_intent_state" CHECK ("notification_intents"."state" in ('pending', 'sending', 'accepted', 'failed', 'uncertain', 'cancelled', 'expanded'));