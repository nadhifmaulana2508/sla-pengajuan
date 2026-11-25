INSERT INTO division_sso_unit_aliases (division_id, unit_kerja, unit_kerja_key)
SELECT id, 'IT', 'it'
FROM master_divisi
WHERE kode = 'operasional'
ON DUPLICATE KEY UPDATE
	division_id = VALUES(division_id),
	unit_kerja = VALUES(unit_kerja);
