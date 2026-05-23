ALTER TABLE "jobs" ADD COLUMN "interview_callback_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "ab_grade_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "resumes_generated" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "emails_sent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "replies_received" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "pipeline_runs_candidate_started_idx" ON "pipeline_runs" USING btree ("candidate_id","started_at");