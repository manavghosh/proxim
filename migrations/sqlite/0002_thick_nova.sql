CREATE TABLE `resume_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`candidate_id` text,
	`archetype` text NOT NULL,
	`archetype_confidence` real,
	`keywords` text,
	`score_at_generation` real,
	`resume_pdf_path` text,
	`cover_letter_pdf_path` text,
	`base_cv_hash` text NOT NULL,
	`is_submitted` integer DEFAULT false NOT NULL,
	`company_research_used` integer DEFAULT false NOT NULL,
	`generation_status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`version_n` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `resume_versions_job_id_idx` ON `resume_versions` (`job_id`);--> statement-breakpoint
CREATE INDEX `resume_versions_base_cv_hash_idx` ON `resume_versions` (`base_cv_hash`);--> statement-breakpoint
ALTER TABLE `candidates` ADD `name` text DEFAULT 'New Candidate' NOT NULL;