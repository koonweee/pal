CREATE TABLE "instance_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"agent_name" text DEFAULT 'pal' NOT NULL,
	"agent_avatar_attachment_id" uuid,
	"accent_color" text DEFAULT '#0066d6' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "instance_settings_singleton" CHECK ("instance_settings"."id" = 1),
	CONSTRAINT "instance_settings_name" CHECK (length(btrim("instance_settings"."agent_name")) between 1 and 60),
	CONSTRAINT "instance_settings_accent" CHECK ("instance_settings"."accent_color" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "instance_settings_version" CHECK ("instance_settings"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_agent_avatar_attachment_id_attachments_id_fk" FOREIGN KEY ("agent_avatar_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;