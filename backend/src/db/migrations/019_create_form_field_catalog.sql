CREATE TABLE form_field_catalog (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	division_id INT UNSIGNED NULL,
	field_key VARCHAR(64) NOT NULL,
	label VARCHAR(160) NOT NULL,
	field_type VARCHAR(16) NOT NULL,
	options_json JSON NULL,
	calculation_json JSON NULL,
	is_standard TINYINT(1) NOT NULL DEFAULT 0,
	is_derived TINYINT(1) NOT NULL DEFAULT 0,
	created_by_user_id BIGINT UNSIGNED NULL,
	created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	PRIMARY KEY (id),
	UNIQUE KEY uq_form_field_catalog_key (field_key),
	UNIQUE KEY uq_form_field_catalog_division_label (division_id, label),
	KEY ix_form_field_catalog_division (division_id, is_standard),
	CONSTRAINT fk_form_field_catalog_division FOREIGN KEY (division_id)
		REFERENCES master_divisi (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_form_field_catalog_creator FOREIGN KEY (created_by_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO form_field_catalog
	(division_id, field_key, label, field_type, options_json, calculation_json, is_standard, is_derived)
VALUES
	(NULL, 'rekening', 'Rekening', 'text', NULL, NULL, 1, 0),
	(NULL, 'nama_debitur', 'Nama Debitur', 'text', NULL, NULL, 1, 0),
	(NULL, 'baki_debet', 'Baki Debet', 'currency', NULL, NULL, 1, 0),
	(NULL, 'saldo_bank', 'Saldo Bank', 'currency', NULL, NULL, 1, 0),
	(NULL, 'kolektibilitas', 'Kolektibilitas', 'select', JSON_ARRAY('L', 'DP', 'KL', 'D', 'M'), NULL, 1, 0),
	(NULL, 'nilai_ckpn', 'Nilai CKPN', 'currency', NULL, NULL, 1, 0),
	(NULL, 'tunggakan_pokok', 'Tunggakan Pokok', 'currency', NULL, NULL, 1, 0),
	(NULL, 'tunggakan_bunga', 'Tunggakan Bunga', 'currency', NULL, NULL, 1, 0),
	(NULL, 'total_tunggakan', 'Total Tunggakan', 'currency', NULL,
		JSON_OBJECT('operation', 'sum', 'fields', JSON_ARRAY('tunggakan_pokok', 'tunggakan_bunga')), 1, 1)
ON DUPLICATE KEY UPDATE field_key = VALUES(field_key);
