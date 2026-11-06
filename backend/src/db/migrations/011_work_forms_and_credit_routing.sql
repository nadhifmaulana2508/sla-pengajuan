ALTER TABLE user_role_scopes
	ADD COLUMN can_manage_forms TINYINT(1) NOT NULL DEFAULT 0 AFTER divisi_id;

ALTER TABLE work_catalogs
	ADD COLUMN system_key VARCHAR(64) NULL,
	ADD UNIQUE KEY uq_work_catalogs_system_key (system_key);

CREATE TABLE work_catalog_form_versions (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	work_catalog_id INT UNSIGNED NOT NULL,
	version_number INT UNSIGNED NOT NULL,
	definition_json JSON NOT NULL,
	published_by_user_id BIGINT UNSIGNED NULL,
	published_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	PRIMARY KEY (id),
	UNIQUE KEY uq_work_catalog_form_version (work_catalog_id, version_number),
	KEY ix_work_catalog_form_published (work_catalog_id, published_at),
	CONSTRAINT fk_work_catalog_form_catalog FOREIGN KEY (work_catalog_id)
		REFERENCES work_catalogs (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_work_catalog_form_publisher FOREIGN KEY (published_by_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE work_catalogs old_credit
INNER JOIN master_divisi division ON division.id = old_credit.divisi_id AND division.kode = 'pemasaran'
INNER JOIN work_catalogs named_credit
	ON named_credit.divisi_id = old_credit.divisi_id
	AND named_credit.nama_pekerjaan = 'Pengajuan Kredit'
SET old_credit.is_active = 0
WHERE old_credit.nama_pekerjaan = 'Pengajuan Kredit di atas Rp500 juta';

UPDATE work_catalogs credit
INNER JOIN master_divisi division ON division.id = credit.divisi_id AND division.kode = 'pemasaran'
SET credit.system_key = 'credit_application'
WHERE credit.nama_pekerjaan = 'Pengajuan Kredit';

UPDATE work_catalogs credit
INNER JOIN master_divisi division ON division.id = credit.divisi_id AND division.kode = 'pemasaran'
LEFT JOIN work_catalogs named_credit
	ON named_credit.divisi_id = credit.divisi_id
	AND named_credit.nama_pekerjaan = 'Pengajuan Kredit'
SET credit.nama_pekerjaan = 'Pengajuan Kredit', credit.system_key = 'credit_application'
WHERE credit.nama_pekerjaan = 'Pengajuan Kredit di atas Rp500 juta'
	AND named_credit.id IS NULL;

INSERT INTO work_catalogs (divisi_id, nama_pekerjaan, target_sla_minutes, is_active, system_key)
SELECT division.id, 'Pengajuan Kredit', 10080, 1, 'credit_application'
FROM master_divisi division
WHERE division.kode = 'pemasaran'
	AND NOT EXISTS (SELECT 1 FROM work_catalogs WHERE system_key = 'credit_application');

UPDATE work_catalogs relief
INNER JOIN master_divisi division ON division.id = relief.divisi_id AND division.kode = 'penyelesaian-kredit'
SET relief.system_key = 'interest_relief'
WHERE relief.nama_pekerjaan = 'Keringanan bunga';

INSERT INTO work_catalogs (divisi_id, nama_pekerjaan, target_sla_minutes, is_active, system_key)
SELECT division.id, 'Keringanan bunga', 10080, 1, 'interest_relief'
FROM master_divisi division
WHERE division.kode = 'penyelesaian-kredit'
	AND NOT EXISTS (SELECT 1 FROM work_catalogs WHERE system_key = 'interest_relief');

INSERT INTO work_catalog_form_versions (work_catalog_id, version_number, definition_json)
SELECT catalog.id, 1,
	'{"fields":[{"key":"credit_amount","label":"Nilai pengajuan kredit (Rp)","type":"currency","required":true,"min_value":250000000,"system":true}]}'
FROM work_catalogs catalog
WHERE catalog.system_key = 'credit_application'
	AND NOT EXISTS (SELECT 1 FROM work_catalog_form_versions WHERE work_catalog_id = catalog.id);

INSERT INTO work_catalog_form_versions (work_catalog_id, version_number, definition_json)
SELECT catalog.id, 1, '{"fields":[]}'
FROM work_catalogs catalog
WHERE catalog.system_key = 'interest_relief'
	AND NOT EXISTS (SELECT 1 FROM work_catalog_form_versions WHERE work_catalog_id = catalog.id);

ALTER TABLE service_requests
	DROP CONSTRAINT chk_service_requests_authority,
	ADD COLUMN form_version_id BIGINT UNSIGNED NULL AFTER work_catalog_id,
	ADD COLUMN form_answers_json JSON NULL AFTER form_version_id,
	ADD COLUMN credit_amount DECIMAL(18,2) NULL AFTER form_answers_json,
	ADD CONSTRAINT chk_service_requests_authority CHECK (
		(authority_type = 'korwil' AND central_division_id IS NULL)
		OR (authority_type = 'central' AND central_division_id IS NOT NULL AND work_catalog_id IS NOT NULL)
	),
	ADD CONSTRAINT fk_service_requests_form_version FOREIGN KEY (form_version_id)
		REFERENCES work_catalog_form_versions (id) ON UPDATE CASCADE ON DELETE RESTRICT;
