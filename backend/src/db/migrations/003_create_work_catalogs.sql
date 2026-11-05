CREATE TABLE IF NOT EXISTS work_catalogs (
	id INT UNSIGNED NOT NULL AUTO_INCREMENT,
	divisi_id INT UNSIGNED NOT NULL,
	nama_pekerjaan VARCHAR(160) NOT NULL,
	deskripsi VARCHAR(500) NULL,
	target_sla_minutes INT UNSIGNED NULL,
	is_active TINYINT(1) NOT NULL DEFAULT 1,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	UNIQUE KEY uq_work_catalogs_divisi_nama (divisi_id, nama_pekerjaan),
	KEY ix_work_catalogs_divisi_active (divisi_id, is_active),
	CONSTRAINT fk_work_catalogs_divisi FOREIGN KEY (divisi_id)
		REFERENCES master_divisi (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO work_catalogs (divisi_id, nama_pekerjaan, is_active)
SELECT id, 'Persetujuan lelang', 1 FROM master_divisi WHERE kode = 'penyelesaian-kredit'
UNION ALL
SELECT id, 'AYDA', 1 FROM master_divisi WHERE kode = 'penyelesaian-kredit'
UNION ALL
SELECT id, 'Hapus buku', 1 FROM master_divisi WHERE kode = 'penyelesaian-kredit'
UNION ALL
SELECT id, 'Keringanan bunga', 1 FROM master_divisi WHERE kode = 'penyelesaian-kredit'
UNION ALL
SELECT id, 'Restruck', 1 FROM master_divisi WHERE kode = 'penyelesaian-kredit'
UNION ALL
SELECT id, 'Pelunasan sebagian', 1 FROM master_divisi WHERE kode = 'penyelesaian-kredit'
UNION ALL
SELECT id, 'Pengajuan Kredit di atas Rp500 juta', 1 FROM master_divisi WHERE kode = 'pemasaran'
UNION ALL
SELECT id, 'Pendampingan hukum', 1 FROM master_divisi WHERE kode = 'sekretaris-perusahaan'
UNION ALL
SELECT id, 'Penanganan fraud', 1 FROM master_divisi WHERE kode = 'sekretaris-perusahaan'
UNION ALL
SELECT id, 'Permintaan EDC', 1 FROM master_divisi WHERE kode = 'operasional'
ON DUPLICATE KEY UPDATE nama_pekerjaan = VALUES(nama_pekerjaan);
