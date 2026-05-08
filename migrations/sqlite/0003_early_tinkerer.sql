CREATE TABLE `hitl_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`status` text DEFAULT 'awaiting' NOT NULL,
	`decision_type` text,
	`snoozed_until` text,
	`decided_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hitl_checkpoints_candidate_status_idx` ON `hitl_checkpoints` (`candidate_id`,`status`);--> statement-breakpoint
CREATE INDEX `hitl_checkpoints_job_id_idx` ON `hitl_checkpoints` (`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `hitl_checkpoints_job_id_unique` ON `hitl_checkpoints` (`job_id`);