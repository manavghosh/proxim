ALTER TABLE `jobs` ADD `archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `archived_at` text;--> statement-breakpoint
CREATE INDEX `jobs_candidate_archived_idx` ON `jobs` (`candidate_id`,`archived`);