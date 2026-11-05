CREATE TABLE IF NOT EXISTS notifications (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	recipient_user_id BIGINT UNSIGNED NOT NULL,
	request_id BIGINT UNSIGNED NOT NULL,
	history_id BIGINT UNSIGNED NOT NULL,
	event_type VARCHAR(50) NOT NULL,
	title VARCHAR(160) NOT NULL,
	body VARCHAR(360) NOT NULL,
	read_at TIMESTAMP(3) NULL DEFAULT NULL,
	created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	PRIMARY KEY (id),
	UNIQUE KEY uq_notifications_recipient_history (recipient_user_id, history_id),
	KEY ix_notifications_recipient_unread (recipient_user_id, read_at, created_at),
	CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_user_id)
		REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,
	CONSTRAINT fk_notifications_request FOREIGN KEY (request_id)
		REFERENCES service_requests (id) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT fk_notifications_history FOREIGN KEY (history_id)
		REFERENCES request_status_histories (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
