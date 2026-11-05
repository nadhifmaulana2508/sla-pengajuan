import { apiRequest } from '#lib/api/client.js';
import type { AuthenticatedProfile } from './auth.types.js';

type LoginResponse = {
	status: number;
	message: string;
	data: { token: string; profile: AuthenticatedProfile };
};

type WhoamiResponse = {
	status: number;
	message: string;
	data: AuthenticatedProfile;
};

let pendingProfileRequest: { token: string; promise: Promise<AuthenticatedProfile> } | null = null;

export async function loginWithSso(idPeg: string, password: string) {
	const response = await apiRequest<LoginResponse>('auth/login', {
		method: 'POST',
		body: { id_peg: idPeg, password }
	});
	return response.data;
}

export function fetchCurrentProfile(token: string): Promise<AuthenticatedProfile> {
	if (pendingProfileRequest?.token === token) return pendingProfileRequest.promise;

	const promise = apiRequest<WhoamiResponse>('auth/whoami', { token })
		.then((response) => response.data)
		.finally(() => {
			if (pendingProfileRequest?.promise === promise) pendingProfileRequest = null;
		});

	pendingProfileRequest = { token, promise };
	return promise;
}
