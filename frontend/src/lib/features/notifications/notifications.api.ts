import { apiRequest } from '#lib/api/client.js';

export type AppNotification = {
	id: number;
	request_id: number;
	request_number: string;
	event_type: string;
	title: string;
	body: string;
	read_at: string | null;
	created_at: string;
};

type NotificationsResponse = {
	status: number;
	message: string;
	data: { notifications: AppNotification[]; unread_count: number };
};

type MutationResponse = { status: number; message: string; data: null };

export async function fetchNotifications(token: string) {
	const response = await apiRequest<NotificationsResponse>('notifications', { token });
	return response.data;
}

export function markNotificationRead(token: string, id: number) {
	return apiRequest<MutationResponse>(`notifications/${id}/read`, { method: 'POST', token });
}

export function markAllNotificationsRead(token: string) {
	return apiRequest<MutationResponse>('notifications/read-all', { method: 'POST', token });
}
