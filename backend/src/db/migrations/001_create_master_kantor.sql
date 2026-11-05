CREATE TABLE IF NOT EXISTS master_kantor (
	id INT UNSIGNED NOT NULL AUTO_INCREMENT,
	kode_kantor CHAR(3) NOT NULL,
	nama_kantor VARCHAR(120) NOT NULL,
	korwil VARCHAR(20) NOT NULL,
	is_active TINYINT(1) NOT NULL DEFAULT 1,
	PRIMARY KEY (id),
	UNIQUE KEY uq_master_kantor_kode_kantor (kode_kantor),
	KEY ix_master_kantor_korwil (korwil)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
