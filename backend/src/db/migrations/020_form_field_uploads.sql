ALTER TABLE request_attachments
	ADD COLUMN form_field_key VARCHAR(64) NULL AFTER revision_id,
	ADD COLUMN form_entry_index TINYINT UNSIGNED NULL AFTER form_field_key,
	ADD COLUMN storage_encoding ENUM('identity', 'gzip') NOT NULL DEFAULT 'identity' AFTER mime_type,
	ADD KEY ix_request_attachments_form_field (request_id, form_field_key, form_entry_index, created_at);
