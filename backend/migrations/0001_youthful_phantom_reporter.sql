LOCK TABLE "automations" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "automations") THEN
    RAISE EXCEPTION 'Preserve legacy automations through the native schedule API before migrating';
  END IF;
END $$;--> statement-breakpoint
DROP TABLE "automations";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;