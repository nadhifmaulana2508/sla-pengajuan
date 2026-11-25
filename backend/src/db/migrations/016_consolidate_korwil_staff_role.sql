-- Keep existing Korwil access by moving old approver assignments to Petugas Korwil.
-- If a matching active Petugas Korwil scope already exists, retain one active assignment.
UPDATE user_role_scopes approver_scope
INNER JOIN roles approver_role ON approver_role.id = approver_scope.role_id
	AND approver_role.kode = 'korwil_approver'
INNER JOIN roles staff_role ON staff_role.kode = 'korwil_staff'
INNER JOIN user_role_scopes staff_scope ON staff_scope.user_id = approver_scope.user_id
	AND staff_scope.role_id = staff_role.id AND staff_scope.is_active = 1
	AND staff_scope.scope_type = approver_scope.scope_type
	AND staff_scope.kode_kantor <=> approver_scope.kode_kantor
	AND staff_scope.korwil <=> approver_scope.korwil
	AND staff_scope.divisi_id <=> approver_scope.divisi_id
SET approver_scope.is_active = 0
WHERE approver_scope.is_active = 1;

UPDATE user_role_scopes approver_scope
INNER JOIN roles approver_role ON approver_role.id = approver_scope.role_id
	AND approver_role.kode = 'korwil_approver'
INNER JOIN roles staff_role ON staff_role.kode = 'korwil_staff'
SET approver_scope.role_id = staff_role.id;

UPDATE dummy_users dummy
INNER JOIN users account ON account.id = dummy.user_id
SET dummy.is_active = 0
WHERE account.employee_id = 'DUMMY-KORWIL-APPROVER-SEMARANG';

UPDATE roles
SET is_active = 0
WHERE kode = 'korwil_approver';
