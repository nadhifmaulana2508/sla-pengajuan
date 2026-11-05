CREATE TABLE IF NOT EXISTS user_access_audit_logs (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	actor_user_id BIGINT UNSIGNED NOT NULL,
	target_user_id BIGINT UNSIGNED NOT NULL,
	action VARCHAR(40) NOT NULL,
	before_data JSON NOT NULL,
	after_data JSON NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	KEY ix_user_access_audit_target_created (target_user_id, created_at),
	KEY ix_user_access_audit_actor_created (actor_user_id, created_at),
	CONSTRAINT fk_user_access_audit_actor FOREIGN KEY (actor_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_user_access_audit_target FOREIGN KEY (target_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
