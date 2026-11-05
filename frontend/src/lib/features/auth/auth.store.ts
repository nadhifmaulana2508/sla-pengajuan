import { writable } from 'svelte/store';
import type { AuthSession, AuthenticatedProfile } from './auth.types.js';

const TOKEN_STORAGE_KEY = 'sla.auth.token';
const EMPLOYEE_ID_STORAGE_KEY = 'sla.auth.employee-id';

function readSessionValue(key: string): string | null {
	if (typeof window === 'undefined') return null;

	try {
		return window.sessionStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeSessionValue(key: string, value: string): void {
	if (typeof window === 'undefined') return;

	try {
		window.sessionStorage.setItem(key, value);
	} catch {
		// The in-memory session still works when browser storage is unavailable.
	}
}

function removeSessionValue(key: string): void {
	if (typeof window === 'undefined') return;

	try {
		window.sessionStorage.removeItem(key);
	} catch {
		// Storage cleanup is best-effort; the in-memory session is always cleared.
	}
}

const emptySession: AuthSession = { token: null, profile: null };
const initialSession: AuthSession = { ...emptySession, token: readSessionValue(TOKEN_STORAGE_KEY) };
const sessionState = writable<AuthSession>(initialSession);

export const authSession = { subscribe: sessionState.subscribe };

export function setAuthenticatedSession(token: string, profile: AuthenticatedProfile): void {
	writeSessionValue(TOKEN_STORAGE_KEY, token);
	sessionState.set({ token, profile });
}

export function getRememberedEmployeeId(): string {
	return readSessionValue(EMPLOYEE_ID_STORAGE_KEY) ?? '';
}

export function rememberEmployeeId(employeeId: string): void {
	const normalizedId = employeeId.trim();
	if (normalizedId) writeSessionValue(EMPLOYEE_ID_STORAGE_KEY, normalizedId);
	else removeSessionValue(EMPLOYEE_ID_STORAGE_KEY);
}

export function updateProfile(profile: AuthenticatedProfile): void {
	sessionState.update((session) => ({ ...session, profile }));
}

export function clearAuthenticatedSession(): void {
	removeSessionValue(TOKEN_STORAGE_KEY);
	sessionState.set(emptySession);
}
