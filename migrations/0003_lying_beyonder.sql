ALTER TABLE "jobs" ADD COLUMN "score10d" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "grade" varchar(1);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "report_md" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "archetype" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "archetype_confidence" numeric(3, 2);