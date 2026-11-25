CREATE TABLE IF NOT EXISTS user_activity_audit_logs (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	actor_user_id BIGINT UNSIGNED NOT NULL,
	http_method VARCHAR(10) NOT NULL,
	path VARCHAR(500) NOT NULL,
	status_code SMALLINT UNSIGNED NOT NULL,
	created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	PRIMARY KEY (id),
	KEY ix_user_activity_audit_actor_created (actor_user_id, created_at),
	KEY ix_user_activity_audit_created (created_at),
	CONSTRAINT fk_user_activity_audit_actor FOREIGN KEY (actor_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
