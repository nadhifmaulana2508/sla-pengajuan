ALTER TABLE service_requests
	MODIFY COLUMN current_unit_type ENUM('branch', 'korwil', 'central') NOT NULL DEFAULT 'korwil',
	ADD COLUMN closed_at TIMESTAMP(3) NULL DEFAULT NULL AFTER submitted_at;

ALTER TABLE request_sla_sessions
	MODIFY COLUMN started_at TIMESTAMP(3) NULL DEFAULT NULL;

UPDATE request_sla_sessions session
INNER JOIN service_requests request ON request.id = session.request_id
SET session.started_at = NULL
WHERE session.unit_type = 'korwil'
	AND session.ended_at IS NULL
	AND session.claimed_at IS NULL
	AND request.status = 'waiting_korwil';

UPDATE request_sla_sessions
SET started_at = claimed_at
WHERE unit_type = 'korwil' AND ended_at IS NULL AND claimed_at IS NOT NULL AND started_at < claimed_at;
