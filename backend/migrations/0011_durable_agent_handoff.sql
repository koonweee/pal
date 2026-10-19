CREATE TABLE "agent_submissions" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_submission_state" CHECK ("agent_submissions"."state" in ('pending', 'sending', 'accepted', 'uncertain'))
);
--> statement-breakpoint
ALTER TABLE "agent_submissions" ADD CONSTRAINT "agent_submissions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;