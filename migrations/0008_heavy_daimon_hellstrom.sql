CREATE TYPE "public"."email_cadence_status" AS ENUM('pending_discovery', 'discovering', 'low_confidence', 'email_not_found', 'generating', 'pending_approval', 'approved', 'active', 'paused', 'auth_expired', 'attachment_missing', 'replied', 'cadence_complete', 'bounced', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."email_draft_status" AS ENUM('draft', 'approved', 'superseded', 'scheduled', 'sending', 'sent', 'bounced', 'rate_limited', 'cancelled');--> statement-breakpoint
CREATE TABLE "email_cadences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"hiring_manager_email" text,
	"email_confidence" integer,
	"email_source" text,
	"gmail_thread_id" text,
	"day1_message_id" text,
	"status" "email_cadence_status" DEFAULT 'pending_discovery' NOT NULL,
	"approved_at" timestamp with time zone,
	"reply_detected_at" timestamp with time zone,
	"bounce_detected_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cadence_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"day_number" integer NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"body_text" text NOT NULL,
	"original_body_html" text NOT NULL,
	"is_approved" boolean DEFAULT false NOT NULL,
	"scheduled_send_at" timestamp with time zone,
	"status" "email_draft_status" DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"gmail_message_id" text,
	"open_detected_at" timestamp with time zone,
	"click_detected_at" timestamp with time zone,
	"bounce_detected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outreach_targets" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "outreach_targets" ADD COLUMN "email_confidence" integer;--> statement-breakpoint
ALTER TABLE "outreach_targets" ADD COLUMN "email_source" text;--> statement-breakpoint
ALTER TABLE "email_cadences" ADD CONSTRAINT "email_cadences_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_cadences" ADD CONSTRAINT "email_cadences_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_cadence_id_email_cadences_id_fk" FOREIGN KEY ("cadence_id") REFERENCES "public"."email_cadences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_cadences_job_id_unique" ON "email_cadences" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "email_cadences_candidate_status_idx" ON "email_cadences" USING btree ("candidate_id","status");--> statement-breakpoint
CREATE INDEX "email_drafts_cadence_day_idx" ON "email_drafts" USING btree ("cadence_id","day_number");--> statement-breakpoint
CREATE INDEX "email_drafts_candidate_status_idx" ON "email_drafts" USING btree ("candidate_id","status");--> statement-breakpoint
CREATE INDEX "email_drafts_scheduled_idx" ON "email_drafts" USING btree ("scheduled_send_at");