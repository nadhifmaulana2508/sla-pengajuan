import { get, writable } from 'svelte/store';

export type ThemeMode = 'light' | 'dark';

const storageKey = 'sla-pengajuan-theme';
export const theme = writable<ThemeMode>('light');

function applyTheme(mode: ThemeMode): void {
	if (typeof document !== 'undefined') {
		document.documentElement.classList.toggle('dark', mode === 'dark');
	}
	theme.set(mode);
}

export function initializeTheme(): void {
	if (typeof window === 'undefined') return;

	let savedTheme: string | null = null;
	try {
		savedTheme = window.localStorage.getItem(storageKey);
	} catch {
		// Keep the system preference when browser storage is unavailable.
	}

	const mode: ThemeMode = savedTheme === 'light' || savedTheme === 'dark'
		? savedTheme
		: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	applyTheme(mode);
}

export function toggleTheme(): void {
	const next: ThemeMode = get(theme) === 'dark' ? 'light' : 'dark';
	applyTheme(next);
	try {
		window.localStorage.setItem(storageKey, next);
	} catch {
		// The current page still changes theme when persistence is unavailable.
	}
}
