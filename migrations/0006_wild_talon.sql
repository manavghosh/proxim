CREATE TYPE "public"."hitl_checkpoint_status" AS ENUM('awaiting', 'approved', 'rejected', 'snoozed');--> statement-breakpoint
ALTER TYPE "public"."job_status" ADD VALUE 'resume_ready';--> statement-breakpoint
ALTER TYPE "public"."job_status" ADD VALUE 'submitted';--> statement-breakpoint
CREATE TABLE "hitl_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"status" "hitl_checkpoint_status" DEFAULT 'awaiting' NOT NULL,
	"decision_type" text,
	"snoozed_until" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hitl_checkpoints" ADD CONSTRAINT "hitl_checkpoints_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hitl_checkpoints" ADD CONSTRAINT "hitl_checkpoints_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hitl_checkpoints_candidate_status_idx" ON "hitl_checkpoints" USING btree ("candidate_id","status");--> statement-breakpoint
CREATE INDEX "hitl_checkpoints_job_id_idx" ON "hitl_checkpoints" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hitl_checkpoints_job_id_unique" ON "hitl_checkpoints" USING btree ("job_id");