ALTER TABLE work_catalogs
	ADD COLUMN routing_flow ENUM('branch_korwil_central', 'branch_central')
		NOT NULL DEFAULT 'branch_korwil_central' AFTER target_sla_minutes;
