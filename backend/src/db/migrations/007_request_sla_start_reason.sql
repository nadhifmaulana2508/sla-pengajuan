ALTER TABLE request_sla_sessions
	ADD COLUMN start_reason ENUM('claim', 'sent') NULL DEFAULT NULL AFTER started_at;

UPDATE request_sla_sessions
SET start_reason = CASE
	WHEN unit_type = 'korwil' AND ended_at IS NULL AND claimed_at IS NOT NULL AND started_at = claimed_at THEN 'claim'
	ELSE 'sent'
END
WHERE started_at IS NOT NULL;
