CREATE TABLE IF NOT EXISTS master_divisi (
	id INT UNSIGNED NOT NULL AUTO_INCREMENT,
	kode VARCHAR(40) NOT NULL,
	nama_divisi VARCHAR(120) NOT NULL,
	is_active TINYINT(1) NOT NULL DEFAULT 1,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	UNIQUE KEY uq_master_divisi_kode (kode),
	UNIQUE KEY uq_master_divisi_nama (nama_divisi)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	employee_id VARCHAR(80) NOT NULL,
	full_name VARCHAR(160) NULL,
	email VARCHAR(190) NULL,
	telp VARCHAR(40) NULL,
	branch_name VARCHAR(150) NULL,
	unit_kerja VARCHAR(150) NULL,
	job_position VARCHAR(150) NULL,
	level VARCHAR(80) NULL,
	group_jabatan VARCHAR(80) NULL,
	kode_kantor CHAR(3) NULL,
	divisi_id INT UNSIGNED NULL,
	is_active TINYINT(1) NOT NULL DEFAULT 0,
	profile_synced_at TIMESTAMP NULL DEFAULT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	UNIQUE KEY uq_users_employee_id (employee_id),
	KEY ix_users_kode_kantor (kode_kantor),
	KEY ix_users_divisi_id (divisi_id),
	KEY ix_users_is_active (is_active),
	CONSTRAINT fk_users_kode_kantor FOREIGN KEY (kode_kantor)
		REFERENCES master_kantor (kode_kantor) ON UPDATE CASCADE ON DELETE SET NULL,
	CONSTRAINT fk_users_divisi FOREIGN KEY (divisi_id)
		REFERENCES master_divisi (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
	id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
	kode VARCHAR(40) NOT NULL,
	nama_role VARCHAR(100) NOT NULL,
	is_active TINYINT(1) NOT NULL DEFAULT 1,
	PRIMARY KEY (id),
	UNIQUE KEY uq_roles_kode (kode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_role_scopes (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	user_id BIGINT UNSIGNED NOT NULL,
	role_id SMALLINT UNSIGNED NOT NULL,
	scope_type ENUM('global', 'office', 'korwil', 'division') NOT NULL,
	kode_kantor CHAR(3) NULL,
	korwil VARCHAR(20) NULL,
	divisi_id INT UNSIGNED NULL,
	is_active TINYINT(1) NOT NULL DEFAULT 1,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	KEY ix_user_role_scopes_user (user_id, is_active),
	KEY ix_user_role_scopes_role (role_id, is_active),
	KEY ix_user_role_scopes_kode_kantor (kode_kantor),
	KEY ix_user_role_scopes_korwil (korwil),
	KEY ix_user_role_scopes_divisi (divisi_id),
	CONSTRAINT chk_user_role_scopes_target CHECK (
		(scope_type = 'global' AND kode_kantor IS NULL AND korwil IS NULL AND divisi_id IS NULL)
		OR (scope_type = 'office' AND kode_kantor IS NOT NULL AND korwil IS NULL AND divisi_id IS NULL)
		OR (scope_type = 'korwil' AND kode_kantor IS NULL AND korwil IS NOT NULL AND divisi_id IS NULL)
		OR (scope_type = 'division' AND kode_kantor IS NULL AND korwil IS NULL AND divisi_id IS NOT NULL)
	),
	CONSTRAINT fk_user_role_scopes_user FOREIGN KEY (user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,
	CONSTRAINT fk_user_role_scopes_role FOREIGN KEY (role_id)
		REFERENCES roles (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_user_role_scopes_kantor FOREIGN KEY (kode_kantor)
		REFERENCES master_kantor (kode_kantor) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_user_role_scopes_divisi FOREIGN KEY (divisi_id)
		REFERENCES master_divisi (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO master_divisi (kode, nama_divisi, is_active) VALUES
	('penyelesaian-kredit', 'Penyelesaian Kredit', 1),
	('pemasaran', 'Pemasaran', 1),
	('sekretaris-perusahaan', 'Sekretaris Perusahaan', 1),
	('operasional', 'Operasional', 1),
	('litbang', 'Litbang', 1),
	('skk', 'SKK', 1),
	('skmr', 'SKMR', 1),
	('skai', 'SKAI', 1),
	('sdm', 'SDM', 1)
ON DUPLICATE KEY UPDATE nama_divisi = VALUES(nama_divisi), is_active = 1;

INSERT INTO roles (kode, nama_role, is_active) VALUES
	('admin', 'Admin', 1),
	('branch_user', 'Pengguna Cabang', 1),
	('korwil_staff', 'Petugas Korwil', 1),
	('korwil_approver', 'Penyetuju Korwil', 1),
	('division_staff', 'Petugas Divisi Pusat', 1),
	('supervisor', 'Supervisor', 1),
	('management', 'Manajemen', 1)
ON DUPLICATE KEY UPDATE nama_role = VALUES(nama_role), is_active = 1;
