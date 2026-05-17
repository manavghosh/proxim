CREATE TABLE `email_cadences` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`hiring_manager_email` text,
	`email_confidence` integer,
	`email_source` text,
	`gmail_thread_id` text,
	`day1_message_id` text,
	`status` text DEFAULT 'pending_discovery' NOT NULL,
	`approved_at` text,
	`reply_detected_at` text,
	`bounce_detected_at` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_cadences_job_id_unique` ON `email_cadences` (`job_id`);--> statement-breakpoint
CREATE INDEX `email_cadences_candidate_status_idx` ON `email_cadences` (`candidate_id`,`status`);--> statement-breakpoint
CREATE TABLE `email_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`cadence_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`day_number` integer NOT NULL,
	`subject` text NOT NULL,
	`body_html` text NOT NULL,
	`body_text` text NOT NULL,
	`original_body_html` text NOT NULL,
	`is_approved` integer DEFAULT false NOT NULL,
	`scheduled_send_at` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`sent_at` text,
	`gmail_message_id` text,
	`open_detected_at` text,
	`click_detected_at` text,
	`bounce_detected_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`cadence_id`) REFERENCES `email_cadences`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `email_drafts_cadence_day_idx` ON `email_drafts` (`cadence_id`,`day_number`);--> statement-breakpoint
CREATE INDEX `email_drafts_candidate_status_idx` ON `email_drafts` (`candidate_id`,`status`);--> statement-breakpoint
CREATE INDEX `email_drafts_scheduled_idx` ON `email_drafts` (`scheduled_send_at`);--> statement-breakpoint
ALTER TABLE `outreach_targets` ADD `email` text;--> statement-breakpoint
ALTER TABLE `outreach_targets` ADD `email_confidence` integer;--> statement-breakpoint
ALTER TABLE `outreach_targets` ADD `email_source` text;