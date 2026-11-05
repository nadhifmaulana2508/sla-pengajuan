CREATE TABLE IF NOT EXISTS division_sso_unit_aliases (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	division_id INT UNSIGNED NOT NULL,
	unit_kerja VARCHAR(150) NOT NULL,
	unit_kerja_key VARCHAR(150) NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	UNIQUE KEY uq_division_sso_unit_alias_key (unit_kerja_key),
	KEY ix_division_sso_unit_alias_division (division_id),
	CONSTRAINT fk_division_sso_unit_alias_division FOREIGN KEY (division_id)
		REFERENCES master_divisi (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO division_sso_unit_aliases (division_id, unit_kerja, unit_kerja_key)
SELECT id, nama_divisi, LOWER(TRIM(nama_divisi)) FROM master_divisi
ON DUPLICATE KEY UPDATE division_id = VALUES(division_id), unit_kerja = VALUES(unit_kerja);

INSERT INTO division_sso_unit_aliases (division_id, unit_kerja, unit_kerja_key)
SELECT id, 'Satuan Kerja Audit Internal', 'satuan kerja audit internal'
FROM master_divisi WHERE kode = 'skai'
ON DUPLICATE KEY UPDATE division_id = VALUES(division_id), unit_kerja = VALUES(unit_kerja);
