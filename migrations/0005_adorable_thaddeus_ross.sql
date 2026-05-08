CREATE TABLE "resume_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"candidate_id" uuid,
	"archetype" text NOT NULL,
	"archetype_confidence" numeric(3, 2),
	"keywords" jsonb,
	"score_at_generation" numeric(4, 2),
	"resume_pdf_path" text,
	"cover_letter_pdf_path" text,
	"base_cv_hash" text NOT NULL,
	"is_submitted" boolean DEFAULT false NOT NULL,
	"company_research_used" boolean DEFAULT false NOT NULL,
	"generation_status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"version_n" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resume_versions_job_id_idx" ON "resume_versions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "resume_versions_base_cv_hash_idx" ON "resume_versions" USING btree ("base_cv_hash");