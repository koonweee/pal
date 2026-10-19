CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_filename" text NOT NULL,
	CONSTRAINT "attachments_storage_filename_unique" UNIQUE("storage_filename"),
	CONSTRAINT "attachment_size" CHECK ("attachments"."size_bytes" between 0 and 25000000)
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"task_id" uuid NOT NULL,
	"schedule" text NOT NULL,
	"prompt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency" (
	"operation" text NOT NULL,
	"key" text NOT NULL,
	"request" jsonb NOT NULL,
	"response" jsonb NOT NULL,
	CONSTRAINT "idempotency_operation_key_pk" PRIMARY KEY("operation","key")
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"message_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "message_attachments_message_id_position_pk" PRIMARY KEY("message_id","position")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"sequence" bigserial NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"task_id" uuid,
	"show_in_main_chat" boolean NOT NULL,
	"actions" jsonb,
	CONSTRAINT "messages_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "message_role" CHECK ("messages"."role" in ('user', 'assistant')),
	CONSTRAINT "main_message_visibility" CHECK ("messages"."task_id" is not null or "messages"."show_in_main_chat")
);
--> statement-breakpoint
CREATE TABLE "task_attachments" (
	"task_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "task_attachments_task_id_position_pk" PRIMARY KEY("task_id","position")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"goal" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'in-progress' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "task_status" CHECK ("tasks"."status" in ('in-progress', 'needs-input', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automations_task_idx" ON "automations" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "message_attachment_reference_idx" ON "message_attachments" USING btree ("attachment_id");--> statement-breakpoint
CREATE INDEX "messages_task_idx" ON "messages" USING btree ("task_id","sequence" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_main_idx" ON "messages" USING btree ("sequence" DESC NULLS LAST) WHERE "messages"."show_in_main_chat";--> statement-breakpoint
CREATE INDEX "task_attachment_reference_idx" ON "task_attachments" USING btree ("attachment_id");--> statement-breakpoint
CREATE INDEX "tasks_history_idx" ON "tasks" USING btree ("archived","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);