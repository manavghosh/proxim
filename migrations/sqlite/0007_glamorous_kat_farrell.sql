ALTER TABLE `email_cadences` ADD `retry_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `error_message` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `interview_callback_at` text;--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD `ab_grade_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD `resumes_generated` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD `emails_sent` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD `replies_received` integer DEFAULT 0 NOT NULL;