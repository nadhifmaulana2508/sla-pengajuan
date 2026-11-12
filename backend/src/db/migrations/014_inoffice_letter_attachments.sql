ALTER TABLE service_requests
	ADD COLUMN inoffice_letter_number VARCHAR(100) NULL AFTER credit_amount,
	ADD COLUMN inoffice_letter_date DATE NULL AFTER inoffice_letter_number;

CREATE TABLE request_attachments (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	request_id BIGINT UNSIGNED NOT NULL,
	category ENUM('inoffice_letter') NOT NULL,
	storage_key CHAR(36) NOT NULL,
	original_filename VARCHAR(255) NOT NULL,
	mime_type VARCHAR(100) NOT NULL,
	size_bytes INT UNSIGNED NOT NULL,
	sha256 CHAR(64) NOT NULL,
	uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
	created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	PRIMARY KEY (id),
	UNIQUE KEY uq_request_attachments_storage_key (storage_key),
	UNIQUE KEY uq_request_attachments_category (request_id, category),
	KEY ix_request_attachments_uploader (uploaded_by_user_id, created_at),
	CONSTRAINT fk_request_attachments_request FOREIGN KEY (request_id)
		REFERENCES service_requests (id) ON UPDATE CASCADE ON DELETE CASCADE,
	CONSTRAINT fk_request_attachments_uploader FOREIGN KEY (uploaded_by_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
