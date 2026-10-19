CREATE TABLE "preference_revisions" (
	"preference_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"actor" text NOT NULL,
	"task_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preference_revisions_preference_id_version_pk" PRIMARY KEY("preference_id","version"),
	CONSTRAINT "preference_revision_version" CHECK ("preference_revisions"."version" > 0),
	CONSTRAINT "preference_actor" CHECK ("preference_revisions"."actor" in ('human', 'main', 'task')),
	CONSTRAINT "preference_actor_task" CHECK (("preference_revisions"."actor" = 'task' and "preference_revisions"."task_id" is not null) or ("preference_revisions"."actor" <> 'task' and "preference_revisions"."task_id" is null))
);
--> statement-breakpoint
CREATE TABLE "preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"topic" text NOT NULL,
	"statement" text NOT NULL,
	"applies_when" text,
	"basis" text NOT NULL,
	"source_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "preference_basis" CHECK ("preferences"."basis" in ('user-stated', 'model-inferred')),
	CONSTRAINT "preference_status" CHECK ("preferences"."status" in ('active', 'retired'))
);
--> statement-breakpoint
ALTER TABLE "preference_revisions" ADD CONSTRAINT "preference_revisions_preference_id_preferences_id_fk" FOREIGN KEY ("preference_id") REFERENCES "public"."preferences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference_revisions" ADD CONSTRAINT "preference_revisions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "preferences_history_idx" ON "preferences" USING btree ("status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);