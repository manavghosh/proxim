CREATE TYPE "public"."outreach_status" AS ENUM('pending', 'discovering', 'enriching', 'generating', 'notes_ready', 'sent', 'queued', 'accepted', 'expired', 'paused', 'no_contact_found', 'skipped_dnc', 'failed');--> statement-breakpoint
CREATE TABLE "outreach_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"name" text,
	"linkedin_url" text,
	"title" text,
	"company" text NOT NULL,
	"seniority" text,
	"enrichment_json" jsonb,
	"note_a" text,
	"note_b" text,
	"selected_note" text,
	"edited_note" text,
	"status" "outreach_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"linkedin_invitation_id" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outreach_targets" ADD CONSTRAINT "outreach_targets_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_targets" ADD CONSTRAINT "outreach_targets_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_targets_job_id_unique" ON "outreach_targets" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "outreach_targets_candidate_status_idx" ON "outreach_targets" USING btree ("candidate_id","status");--> statement-breakpoint
CREATE INDEX "outreach_targets_sent_at_idx" ON "outreach_targets" USING btree ("sent_at");