CREATE TABLE `candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text,
	`base_cv_md` text,
	`base_cv_hash` text,
	`parsed_profile` text,
	`parse_status` text DEFAULT 'pending' NOT NULL,
	`preferences` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`pipeline_run_id` text NOT NULL,
	`title` text NOT NULL,
	`company` text NOT NULL,
	`location` text,
	`jd_raw` text NOT NULL,
	`jd_text` text,
	`source` text NOT NULL,
	`source_url` text NOT NULL,
	`application_url` text,
	`posted_at` text,
	`status` text DEFAULT 'discovered' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_candidate_status_idx` ON `jobs` (`candidate_id`,`status`);--> statement-breakpoint
CREATE INDEX `jobs_candidate_source_url_idx` ON `jobs` (`candidate_id`,`source_url`);--> statement-breakpoint
CREATE TABLE `pipeline_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`job_type` text NOT NULL,
	`candidate_id` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`error` text,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pipeline_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_job_id` text NOT NULL,
	`level` text NOT NULL,
	`step` text NOT NULL,
	`message` text NOT NULL,
	`data` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`pipeline_job_id`) REFERENCES `pipeline_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pipeline_logs_job_created_idx` ON `pipeline_logs` (`pipeline_job_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_job_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`sources_attempted` integer DEFAULT 0 NOT NULL,
	`sources_successful` integer DEFAULT 0 NOT NULL,
	`jobs_discovered` integer DEFAULT 0 NOT NULL,
	`jobs_deduplicated` integer DEFAULT 0 NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`summary` text,
	`error` text,
	FOREIGN KEY (`pipeline_job_id`) REFERENCES `pipeline_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scan_history` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`url` text NOT NULL,
	`job_id` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scan_history_candidate_url_idx` ON `scan_history` (`candidate_id`,`url`);