CREATE TABLE `outreach_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`name` text,
	`linkedin_url` text,
	`title` text,
	`company` text NOT NULL,
	`seniority` text,
	`enrichment_json` text,
	`note_a` text,
	`note_b` text,
	`selected_note` text,
	`edited_note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`sent_at` text,
	`accepted_at` text,
	`last_polled_at` text,
	`linkedin_invitation_id` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outreach_targets_job_id_unique` ON `outreach_targets` (`job_id`);--> statement-breakpoint
CREATE INDEX `outreach_targets_candidate_status_idx` ON `outreach_targets` (`candidate_id`,`status`);