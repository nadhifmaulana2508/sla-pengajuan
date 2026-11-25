CREATE TABLE request_recaps (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	division_id INT UNSIGNED NOT NULL,
	work_catalog_id INT UNSIGNED NOT NULL,
	title VARCHAR(160) NOT NULL,
	status ENUM('published', 'archived') NOT NULL DEFAULT 'published',
	source_fields_json JSON NOT NULL,
	visible_source_keys_json JSON NOT NULL,
	tracking_fields_json JSON NOT NULL,
	created_by_user_id BIGINT UNSIGNED NOT NULL,
	created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	published_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	PRIMARY KEY (id),
	KEY ix_request_recaps_division (division_id, status, created_at),
	KEY ix_request_recaps_catalog (work_catalog_id, status),
	CONSTRAINT fk_request_recaps_division FOREIGN KEY (division_id)
		REFERENCES master_divisi (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_request_recaps_catalog FOREIGN KEY (work_catalog_id)
		REFERENCES work_catalogs (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_request_recaps_creator FOREIGN KEY (created_by_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE request_recap_rows (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	recap_id BIGINT UNSIGNED NOT NULL,
	source_request_id BIGINT UNSIGNED NOT NULL,
	kode_kantor CHAR(3) NOT NULL,
	form_entry_index TINYINT UNSIGNED NULL,
	source_entry_key TINYINT UNSIGNED NOT NULL,
	source_values_json JSON NOT NULL,
	tracking_values_json JSON NOT NULL,
	created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	PRIMARY KEY (id),
	UNIQUE KEY uq_request_recap_source_entry (recap_id, source_request_id, source_entry_key),
	KEY ix_request_recap_rows_office (recap_id, kode_kantor, id),
	CONSTRAINT fk_request_recap_rows_recap FOREIGN KEY (recap_id)
		REFERENCES request_recaps (id) ON UPDATE CASCADE ON DELETE CASCADE,
	CONSTRAINT fk_request_recap_rows_request FOREIGN KEY (source_request_id)
		REFERENCES service_requests (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_request_recap_rows_office FOREIGN KEY (kode_kantor)
		REFERENCES master_kantor (kode_kantor) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE request_recap_proposals (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	recap_row_id BIGINT UNSIGNED NOT NULL,
	proposed_by_user_id BIGINT UNSIGNED NOT NULL,
	proposed_changes_json JSON NOT NULL,
	note VARCHAR(1000) NOT NULL,
	status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
	reviewed_by_user_id BIGINT UNSIGNED NULL,
	review_note VARCHAR(1000) NULL,
	created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	reviewed_at TIMESTAMP(3) NULL,
	PRIMARY KEY (id),
	KEY ix_request_recap_proposals_pending (recap_row_id, status, created_at),
	CONSTRAINT fk_request_recap_proposals_row FOREIGN KEY (recap_row_id)
		REFERENCES request_recap_rows (id) ON UPDATE CASCADE ON DELETE CASCADE,
	CONSTRAINT fk_request_recap_proposals_author FOREIGN KEY (proposed_by_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_request_recap_proposals_reviewer FOREIGN KEY (reviewed_by_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
