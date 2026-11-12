import type { RowDataPacket } from 'mysql2';
import { env } from '../../config/env.js';
import { mysqlPool } from '../../db/client.js';
import { resolveSlaAccess, syncSsoProfile } from './access.service.js';
import { createSsoClient, SsoAuthError, type SsoProfile } from './auth.service.js';

const DUMMY_TOKEN_PREFIX = 'sla-dummy:';

const sso = createSsoClient({
	baseUrl: env.SSO_BASE_URL,
	appCode: env.SSO_APP_CODE,
	timeoutMs: env.SSO_TIMEOUT_MS,
	connectIp: env.SSO_CONNECT_IP
});

type DummyProfileRow = RowDataPacket & SsoProfile;

export type DummyUserOption = {
	employee_id: string;
	label: string;
	role_code: string;
	role_name: string;
	scope_label: string;
};

function dummyAuthEnabled(): boolean {
	if (!env.DUMMY_AUTH_ENABLED) return false;
	if (env.NODE_ENV === 'development') return true;
	return env.NODE_ENV === 'production' && /_staging$/i.test(env.DB_NAME);
}

async function findDummyProfile(employeeId: string): Promise<SsoProfile | null> {
	const [rows] = await mysqlPool.execute<DummyProfileRow[]>(
		`SELECT u.employee_id, u.full_name, u.email, u.telp, u.branch_name,
			u.unit_kerja, u.job_position, u.level, u.group_jabatan,
			u.kode_kantor AS kode
		FROM dummy_users dummy
		INNER JOIN users u ON u.id = dummy.user_id AND u.is_active = 1
		WHERE dummy.is_active = 1 AND u.employee_id = ?
		LIMIT 1`,
		[employeeId]
	);
	return rows[0] ?? null;
}

export async function listDummyUsers(): Promise<DummyUserOption[]> {
	if (!dummyAuthEnabled()) return [];

	const [rows] = await mysqlPool.execute<Array<RowDataPacket & DummyUserOption>>(
		`SELECT u.employee_id, dummy.label, role.kode AS role_code, role.nama_role AS role_name,
			CASE scope.scope_type
				WHEN 'office' THEN CONCAT('Kantor ', office.nama_kantor, ' (', scope.kode_kantor, ')')
				WHEN 'korwil' THEN CONCAT('Korwil ', scope.korwil)
				WHEN 'division' THEN CONCAT('Divisi ', division.nama_divisi)
				ELSE 'Global'
			END AS scope_label
		FROM dummy_users dummy
		INNER JOIN users u ON u.id = dummy.user_id AND u.is_active = 1
		INNER JOIN user_role_scopes scope ON scope.user_id = u.id AND scope.is_active = 1
		INNER JOIN roles role ON role.id = scope.role_id AND role.is_active = 1
		LEFT JOIN master_kantor office ON office.kode_kantor = scope.kode_kantor
		LEFT JOIN master_divisi division ON division.id = scope.divisi_id
		WHERE dummy.is_active = 1
		ORDER BY role.id, dummy.label`
	);
	return rows;
}

export async function loginAsDummy(employeeId: string): Promise<{ token: string; profile: SsoProfile & { sla_access: Awaited<ReturnType<typeof resolveSlaAccess>> } }> {
	if (!dummyAuthEnabled()) {
		throw new SsoAuthError(401, 'Login akun uji hanya tersedia pada development atau staging yang mengaktifkannya.');
	}

	const profile = await findDummyProfile(employeeId);
	if (!profile) throw new SsoAuthError(401, 'Akun dummy tidak ditemukan atau sedang dinonaktifkan.');

	const access = await resolveSlaAccess(profile.employee_id);
	if (!access.enabled) throw new SsoAuthError(403, 'Akun dummy belum memiliki role dan cakupan yang aktif.');

	return {
		token: `${DUMMY_TOKEN_PREFIX}${profile.employee_id}`,
		profile: { ...profile, sla_access: access }
	};
}

export async function loginWithSso(idPeg: string, password: string): Promise<{ token: string; profile: SsoProfile }> {
	const result = await sso.login(idPeg, password);
	await syncSsoProfile(result.profile);
	return result;
}

export async function resolveBearerIdentity(token: string): Promise<SsoProfile> {
	if (token.startsWith(DUMMY_TOKEN_PREFIX)) {
		if (!dummyAuthEnabled()) {
			throw new SsoAuthError(401, 'Sesi akun uji tidak tersedia pada lingkungan ini.');
		}
		const employeeId = token.slice(DUMMY_TOKEN_PREFIX.length);
		const profile = await findDummyProfile(employeeId);
		if (!profile) throw new SsoAuthError(401, 'Sesi akun dummy tidak valid atau sudah dinonaktifkan.');
		return profile;
	}

	const profile = await sso.whoami(token);
	await syncSsoProfile(profile);
	return profile;
}

export function isDummyAuthAvailable(): boolean {
	return dummyAuthEnabled();
}
