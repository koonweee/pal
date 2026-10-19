CREATE TABLE "mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"auth" jsonb DEFAULT '{"type":"none"}'::jsonb NOT NULL,
	"oauth" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auth_epoch" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "mcp_servers_name_unique" UNIQUE("name")
);
