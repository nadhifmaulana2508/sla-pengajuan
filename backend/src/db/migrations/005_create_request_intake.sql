CREATE TABLE IF NOT EXISTS service_requests (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	request_number VARCHAR(24) NULL,
	created_by_user_id BIGINT UNSIGNED NOT NULL,
	kode_kantor CHAR(3) NOT NULL,
	korwil VARCHAR(20) NOT NULL,
	authority_type ENUM('korwil', 'central') NOT NULL,
	central_division_id INT UNSIGNED NULL,
	work_catalog_id INT UNSIGNED NULL,
	subject VARCHAR(200) NOT NULL,
	description TEXT NOT NULL,
	status VARCHAR(40) NOT NULL DEFAULT 'waiting_korwil',
	current_unit_type ENUM('korwil', 'central') NOT NULL DEFAULT 'korwil',
	current_unit_code VARCHAR(40) NOT NULL,
	current_owner_user_id BIGINT UNSIGNED NULL,
	submitted_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	PRIMARY KEY (id),
	UNIQUE KEY uq_service_requests_number (request_number),
	KEY ix_service_requests_office_submitted (kode_kantor, submitted_at),
	KEY ix_service_requests_korwil_status (korwil, status, submitted_at),
	KEY ix_service_requests_owner_status (current_owner_user_id, status),
	CONSTRAINT chk_service_requests_authority CHECK (
		(authority_type = 'korwil' AND central_division_id IS NULL AND work_catalog_id IS NULL)
		OR (authority_type = 'central' AND central_division_id IS NOT NULL AND work_catalog_id IS NOT NULL)
	),
	CONSTRAINT fk_service_requests_creator FOREIGN KEY (created_by_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_service_requests_office FOREIGN KEY (kode_kantor)
		REFERENCES master_kantor (kode_kantor) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_service_requests_division FOREIGN KEY (central_division_id)
		REFERENCES master_divisi (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_service_requests_catalog FOREIGN KEY (work_catalog_id)
		REFERENCES work_catalogs (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_service_requests_owner FOREIGN KEY (current_owner_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS request_assignments (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	request_id BIGINT UNSIGNED NOT NULL,
	unit_type ENUM('branch', 'korwil', 'central') NOT NULL,
	unit_code VARCHAR(40) NOT NULL,
	assigned_user_id BIGINT UNSIGNED NULL,
	assigned_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	claimed_at TIMESTAMP(3) NULL DEFAULT NULL,
	released_at TIMESTAMP(3) NULL DEFAULT NULL,
	PRIMARY KEY (id),
	KEY ix_request_assignments_request_active (request_id, released_at),
	KEY ix_request_assignments_user_active (assigned_user_id, released_at),
	CONSTRAINT fk_request_assignments_request FOREIGN KEY (request_id)
		REFERENCES service_requests (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_request_assignments_user FOREIGN KEY (assigned_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS request_sla_sessions (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	request_id BIGINT UNSIGNED NOT NULL,
	unit_type ENUM('branch', 'korwil', 'central') NOT NULL,
	unit_code VARCHAR(40) NOT NULL,
	started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	claimed_at TIMESTAMP(3) NULL DEFAULT NULL,
	ended_at TIMESTAMP(3) NULL DEFAULT NULL,
	duration_seconds BIGINT UNSIGNED NULL,
	target_sla_minutes INT UNSIGNED NULL,
	outcome VARCHAR(40) NULL,
	created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	PRIMARY KEY (id),
	KEY ix_request_sla_request_unit (request_id, unit_type, unit_code, started_at),
	KEY ix_request_sla_active (request_id, ended_at),
	CONSTRAINT fk_request_sla_request FOREIGN KEY (request_id)
		REFERENCES service_requests (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS request_status_histories (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	request_id BIGINT UNSIGNED NOT NULL,
	actor_user_id BIGINT UNSIGNED NOT NULL,
	action_name VARCHAR(40) NOT NULL,
	status_from VARCHAR(40) NULL,
	status_to VARCHAR(40) NOT NULL,
	unit_from_type ENUM('branch', 'korwil', 'central') NULL,
	unit_from_code VARCHAR(40) NULL,
	unit_to_type ENUM('branch', 'korwil', 'central') NOT NULL,
	unit_to_code VARCHAR(40) NOT NULL,
	reason VARCHAR(1000) NULL,
	created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	PRIMARY KEY (id),
	KEY ix_request_status_history_timeline (request_id, created_at, id),
	KEY ix_request_status_history_actor (actor_user_id, created_at),
	CONSTRAINT fk_request_status_history_request FOREIGN KEY (request_id)
		REFERENCES service_requests (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_request_status_history_actor FOREIGN KEY (actor_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
