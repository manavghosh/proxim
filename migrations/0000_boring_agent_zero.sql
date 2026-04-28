CREATE TYPE "public"."parse_status" AS ENUM('pending', 'parsing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid,
	"base_cv_md" text,
	"base_cv_hash" varchar(64),
	"parsed_profile" jsonb,
	"parse_status" "parse_status" DEFAULT 'pending' NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
