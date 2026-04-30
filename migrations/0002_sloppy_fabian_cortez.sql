CREATE TABLE "pipeline_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_job_id" uuid NOT NULL,
	"level" text NOT NULL,
	"step" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipeline_logs" ADD CONSTRAINT "pipeline_logs_pipeline_job_id_pipeline_jobs_id_fk" FOREIGN KEY ("pipeline_job_id") REFERENCES "public"."pipeline_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pipeline_logs_job_created_idx" ON "pipeline_logs" USING btree ("pipeline_job_id","created_at");