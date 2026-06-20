ALTER TABLE "jobs" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "jobs_candidate_archived_idx" ON "jobs" USING btree ("candidate_id","archived");