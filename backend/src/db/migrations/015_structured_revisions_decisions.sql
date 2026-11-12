ALTER TABLE request_attachments
	DROP INDEX uq_request_attachments_category,
	MODIFY COLUMN category VARCHAR(64) NOT NULL,
	ADD COLUMN revision_id BIGINT UNSIGNED NULL AFTER request_id,
	ADD KEY ix_request_attachments_request_category (request_id, category, created_at);

CREATE TABLE rejection_reasons (
	id INT UNSIGNED NOT NULL AUTO_INCREMENT,
	scope_type ENUM('system', 'division', 'catalog') NOT NULL,
	division_id INT UNSIGNED NULL,
	work_catalog_id INT UNSIGNED NULL,
	code VARCHAR(100) NOT NULL,
	label VARCHAR(160) NOT NULL,
	is_active TINYINT(1) NOT NULL DEFAULT 1,
	sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 100,
	created_by_user_id BIGINT UNSIGNED NULL,
	created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	PRIMARY KEY (id),
	KEY ix_rejection_reasons_effective (scope_type, division_id, work_catalog_id, is_active, sort_order),
	CONSTRAINT chk_rejection_reasons_scope CHECK (
		(scope_type = 'system' AND division_id IS NULL AND work_catalog_id IS NULL)
		OR (scope_type = 'division' AND division_id IS NOT NULL AND work_catalog_id IS NULL)
		OR (scope_type = 'catalog' AND division_id IS NOT NULL AND work_catalog_id IS NOT NULL)
	),
	CONSTRAINT fk_rejection_reasons_division FOREIGN KEY (division_id)
		REFERENCES master_divisi (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_rejection_reasons_catalog FOREIGN KEY (work_catalog_id)
		REFERENCES work_catalogs (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_rejection_reasons_creator FOREIGN KEY (created_by_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO rejection_reasons (scope_type, code, label, sort_order) VALUES
	('system', 'requirements_not_met', 'Tidak memenuhi persyaratan', 10),
	('system', 'outside_authority', 'Di luar kewenangan atau cakupan', 20),
	('system', 'invalid_documents', 'Dokumen tidak valid', 30),
	('system', 'unverifiable_data', 'Data tidak dapat diverifikasi', 40),
	('system', 'other', 'Lainnya', 100);

CREATE TABLE request_revisions (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	request_id BIGINT UNSIGNED NOT NULL,
	revision_number INT UNSIGNED NOT NULL,
	requested_by_user_id BIGINT UNSIGNED NOT NULL,
	requesting_unit_type ENUM('korwil', 'central') NOT NULL,
	requesting_unit_code VARCHAR(40) NOT NULL,
	request_note VARCHAR(1000) NOT NULL,
	requested_fields_json JSON NOT NULL,
	requested_documents_json JSON NOT NULL,
	snapshot_before_json JSON NOT NULL,
	snapshot_after_json JSON NULL,
	response_note VARCHAR(5000) NULL,
	response_by_user_id BIGINT UNSIGNED NULL,
	status ENUM('requested', 'submitted') NOT NULL DEFAULT 'requested',
	requested_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	submitted_at TIMESTAMP(3) NULL,
	PRIMARY KEY (id),
	UNIQUE KEY uq_request_revisions_number (request_id, revision_number),
	KEY ix_request_revisions_pending (request_id, status, id),
	CONSTRAINT fk_request_revisions_request FOREIGN KEY (request_id)
		REFERENCES service_requests (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_request_revisions_requester FOREIGN KEY (requested_by_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_request_revisions_responder FOREIGN KEY (response_by_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE request_attachments
	ADD CONSTRAINT fk_request_attachments_revision FOREIGN KEY (revision_id)
		REFERENCES request_revisions (id) ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE TABLE request_decisions (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	request_id BIGINT UNSIGNED NOT NULL,
	history_id BIGINT UNSIGNED NOT NULL,
	actor_user_id BIGINT UNSIGNED NOT NULL,
	unit_type ENUM('korwil', 'central') NOT NULL,
	unit_code VARCHAR(40) NOT NULL,
	decision_type ENUM('forwarded', 'approved', 'rejected') NOT NULL,
	rejection_reason_id INT UNSIGNED NULL,
	reason_code_snapshot VARCHAR(100) NULL,
	reason_label_snapshot VARCHAR(160) NULL,
	note VARCHAR(1000) NOT NULL,
	confirmation_text VARCHAR(500) NULL,
	attachment_id BIGINT UNSIGNED NULL,
	created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	PRIMARY KEY (id),
	UNIQUE KEY uq_request_decisions_history (history_id),
	KEY ix_request_decisions_request (request_id, created_at, id),
	CONSTRAINT fk_request_decisions_request FOREIGN KEY (request_id)
		REFERENCES service_requests (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_request_decisions_history FOREIGN KEY (history_id)
		REFERENCES request_status_histories (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_request_decisions_actor FOREIGN KEY (actor_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_request_decisions_reason FOREIGN KEY (rejection_reason_id)
		REFERENCES rejection_reasons (id) ON UPDATE CASCADE ON DELETE SET NULL,
	CONSTRAINT fk_request_decisions_attachment FOREIGN KEY (attachment_id)
		REFERENCES request_attachments (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
