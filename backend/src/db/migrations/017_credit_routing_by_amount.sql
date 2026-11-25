-- Keep published form versions immutable and publish the new credit minimum
-- and fixed Marketing threshold as the next version for future submissions.
INSERT INTO work_catalog_form_versions
	(work_catalog_id, version_number, definition_json, published_by_user_id)
SELECT catalog.id,
	latest_form.version_number + 1,
	JSON_SET(
		JSON_SET(latest_form.definition_json, '$.fields[0].min_value', 200000000),
		'$.credit_routing', JSON_OBJECT('marketing_threshold_amount', 500000000)
	),
	NULL
FROM work_catalogs catalog
INNER JOIN work_catalog_form_versions latest_form ON latest_form.id = (
	SELECT form_version.id
	FROM work_catalog_form_versions form_version
	WHERE form_version.work_catalog_id = catalog.id
	ORDER BY form_version.version_number DESC
	LIMIT 1
)
WHERE catalog.system_key = 'credit_application';
