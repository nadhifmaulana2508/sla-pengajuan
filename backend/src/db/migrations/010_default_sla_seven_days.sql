UPDATE work_catalogs
SET target_sla_minutes = 10080
WHERE target_sla_minutes IS NULL OR target_sla_minutes <> 10080;

UPDATE request_sla_sessions
SET target_sla_minutes = 10080
WHERE target_sla_minutes IS NULL OR target_sla_minutes <> 10080;
