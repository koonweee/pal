CREATE TABLE "adapter_state" (
	"adapter_id" text NOT NULL,
	"destination_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adapter_state_adapter_id_destination_id_key_pk" PRIMARY KEY("adapter_id","destination_id","key")
);
--> statement-breakpoint
CREATE TABLE "delivery_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"message_id" uuid NOT NULL,
	"destination_id" text NOT NULL,
	"adapter_id" text NOT NULL,
	"notify" boolean NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"accepted_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" text,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_job_state" CHECK ("delivery_jobs"."state" in ('pending', 'sending', 'accepted', 'failed', 'uncertain', 'cancelled')),
	CONSTRAINT "delivery_job_attempts" CHECK ("delivery_jobs"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "destinations" (
	"id" text PRIMARY KEY NOT NULL,
	"adapter_id" text NOT NULL,
	"role" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "destination_role" CHECK ("destinations"."role" in ('canonical', 'secondary')),
	CONSTRAINT "destination_id" CHECK ("destinations"."id" ~ '^[a-z][a-z0-9:_-]{0,99}$')
);
--> statement-breakpoint
INSERT INTO "destinations" ("id", "adapter_id", "role", "enabled") VALUES
	('web', 'first-party', 'canonical', true),
	('ios', 'first-party', 'canonical', true),
	('telegram', 'telegram', 'secondary', false);--> statement-breakpoint
CREATE TABLE "external_message_references" (
	"adapter_id" text NOT NULL,
	"destination_id" text NOT NULL,
	"external_message_id" text NOT NULL,
	"external_thread_id" text,
	"canonical_message_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_message_references_adapter_id_destination_id_external_message_id_pk" PRIMARY KEY("adapter_id","destination_id","external_message_id"),
	CONSTRAINT "external_reference_direction" CHECK ("external_message_references"."direction" in ('incoming', 'outgoing')),
	CONSTRAINT "external_reference_position" CHECK ("external_message_references"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "secondary_inputs" (
	"adapter_id" text NOT NULL,
	"destination_id" text NOT NULL,
	"external_event_id" text NOT NULL,
	"canonical_message_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secondary_inputs_adapter_id_destination_id_external_event_id_pk" PRIMARY KEY("adapter_id","destination_id","external_event_id")
);
--> statement-breakpoint
ALTER TABLE "messages" RENAME COLUMN "delivery_channels" TO "delivery_destination_ids";--> statement-breakpoint
ALTER TABLE "messages" RENAME COLUMN "notification_channels" TO "notification_destination_ids";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "message_notification_channels";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "message_delivery_channels";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "message_source";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "origin_destination_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "participant_destination_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "messages" SET
	"origin_destination_id" = CASE "source"
		WHEN 'web' THEN 'web'
		WHEN 'ios' THEN 'ios'
		WHEN 'telegram' THEN 'telegram'
		ELSE NULL
	END,
	"delivery_destination_ids" = COALESCE((
		SELECT jsonb_agg(CASE channel
			WHEN 'web_push' THEN 'web'
			WHEN 'ios_push' THEN 'ios'
			WHEN 'telegram' THEN 'telegram'
		END ORDER BY position)
		FROM jsonb_array_elements_text("delivery_destination_ids") WITH ORDINALITY AS legacy(channel, position)
	), '[]'::jsonb),
	"notification_destination_ids" = COALESCE((
		SELECT jsonb_agg(CASE channel
			WHEN 'web_push' THEN 'web'
			WHEN 'ios_push' THEN 'ios'
			WHEN 'telegram' THEN 'telegram'
		END ORDER BY position)
		FROM jsonb_array_elements_text("notification_destination_ids") WITH ORDINALITY AS legacy(channel, position)
	), '[]'::jsonb);--> statement-breakpoint
ALTER TABLE "adapter_state" ADD CONSTRAINT "adapter_state_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_message_references" ADD CONSTRAINT "external_message_references_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_message_references" ADD CONSTRAINT "external_message_references_canonical_message_id_messages_id_fk" FOREIGN KEY ("canonical_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secondary_inputs" ADD CONSTRAINT "secondary_inputs_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secondary_inputs" ADD CONSTRAINT "secondary_inputs_canonical_message_id_messages_id_fk" FOREIGN KEY ("canonical_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_job_message_destination_idx" ON "delivery_jobs" USING btree ("message_id","destination_id");--> statement-breakpoint
CREATE INDEX "delivery_job_dispatch_idx" ON "delivery_jobs" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "destinations_adapter_idx" ON "destinations" USING btree ("adapter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_reference_canonical_position_idx" ON "external_message_references" USING btree ("adapter_id","destination_id","canonical_message_id","direction","position");--> statement-breakpoint
CREATE INDEX "external_reference_canonical_idx" ON "external_message_references" USING btree ("adapter_id","destination_id","canonical_message_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_origin_destination_id_destinations_id_fk" FOREIGN KEY ("origin_destination_id") REFERENCES "public"."destinations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "message_notification_destinations" CHECK (jsonb_typeof("messages"."notification_destination_ids") = 'array' and "messages"."notification_destination_ids" <@ "messages"."delivery_destination_ids" and "messages"."notify" = ("messages"."notification_destination_ids" <> '[]'::jsonb));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "message_destinations" CHECK (jsonb_typeof("messages"."participant_destination_ids") = 'array' and jsonb_typeof("messages"."delivery_destination_ids") = 'array' and ("messages"."role" = 'assistant' or ("messages"."participant_destination_ids" = '[]'::jsonb and "messages"."delivery_destination_ids" = '[]'::jsonb and "messages"."notification_destination_ids" = '[]'::jsonb)));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "message_source" CHECK (("messages"."role" = 'user' and "messages"."source" is not null) or ("messages"."role" = 'assistant' and "messages"."source" is null and "messages"."origin_destination_id" is null));
