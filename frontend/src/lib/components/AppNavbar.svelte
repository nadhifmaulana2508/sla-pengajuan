<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '#lib/api/client.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { fetchCurrentProfile } from '#lib/features/auth/auth.api.js';
	import {
		authSession,
		clearAuthenticatedSession,
		updateProfile
	} from '#lib/features/auth/auth.store.js';
	import { theme, toggleTheme } from '#lib/features/theme/theme.store.js';
	import { Bell, BriefcaseBusiness, Building2, Check, CheckCheck, ClipboardList, House, Inbox, LogOut, Menu, Moon, Sun, UsersRound, X } from '@lucide/svelte';
	import {
		fetchNotifications,
		markAllNotificationsRead,
		markNotificationRead,
		type AppNotification
	} from '#lib/features/notifications/notifications.api.js';

	let role = $state<string | null>(null);
	let mobileMenuOpen = $state(false);
	let notificationsOpen = $state(false);
	let notifications = $state<AppNotification[]>([]);
	let unreadCount = $state(0);
	let notificationsLoading = $state(false);
	let notificationsError = $state('');
	let openingNotificationId = $state<number | null>(null);
	let markingAllNotifications = $state(false);
	let currentPath = $derived(page.url.pathname);
	let activeToken: string | null = null;
	let profileFetchToken: string | null = null;
	let notificationsToken: string | null = null;
	let pendingNotificationToken: string | null = null;
	let pendingNotificationLoad: Promise<void> | null = null;

	onMount(() => authSession.subscribe((session) => {
		activeToken = session.token;
		role = session.profile?.sla_access.role ?? null;
		if (session.token && !session.profile && !currentPath.startsWith('/admin/users')) void restoreProfile(session.token);
		if (!session.token) {
			notificationsToken = null;
			notifications = [];
			unreadCount = 0;
			notificationsError = '';
		} else if (session.profile?.sla_access.enabled && notificationsToken !== session.token) {
			notificationsToken = session.token;
			void loadNotifications(session.token);
		} else if (session.profile && !session.profile.sla_access.enabled) {
			notificationsToken = null;
			notifications = [];
			unreadCount = 0;
			notificationsError = '';
		}
	}));

	function loadNotifications(token: string): Promise<void> {
		if (pendingNotificationLoad && pendingNotificationToken === token) return pendingNotificationLoad;
		notificationsLoading = true;
		notificationsError = '';
		pendingNotificationToken = token;
		const request = fetchNotifications(token)
			.then((data) => {
				if (activeToken !== token) return;
				notifications = data.notifications;
				unreadCount = data.unread_count;
			})
			.catch((error: unknown) => {
				if (activeToken !== token) return;
				if (error instanceof ApiError && error.status === 401) {
					clearAuthenticatedSession();
					void goto('/');
					return;
				}
				notificationsError = error instanceof ApiError
					? error.message
					: 'Notifikasi belum dapat dimuat. Coba lagi.';
			})
			.finally(() => {
				if (pendingNotificationToken === token) {
					pendingNotificationLoad = null;
					pendingNotificationToken = null;
					notificationsLoading = false;
				}
			});
		pendingNotificationLoad = request;
		return request;
	}

	function showNotifications(): void {
		notificationsOpen = true;
		if (activeToken) void loadNotifications(activeToken);
	}

	async function openNotification(item: AppNotification): Promise<void> {
		const token = activeToken;
		if (!token || openingNotificationId !== null) return;
		openingNotificationId = item.id;
		try {
			await markNotificationRead(token, item.id);
			notifications = notifications.map((notification) => notification.id === item.id
				? { ...notification, read_at: new Date().toISOString() }
				: notification);
			if (!item.read_at) unreadCount = Math.max(0, unreadCount - 1);
			notificationsOpen = false;
			await goto(`/requests/${item.request_id}`);
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				clearAuthenticatedSession();
				void goto('/');
				return;
			}
			notificationsError = error instanceof ApiError
				? error.message
				: 'Notifikasi belum dapat dibuka. Coba lagi.';
		} finally {
			if (openingNotificationId === item.id) openingNotificationId = null;
		}
	}

	async function readAllNotifications(): Promise<void> {
		const token = activeToken;
		if (!token || unreadCount === 0 || markingAllNotifications) return;
		markingAllNotifications = true;
		try {
			await markAllNotificationsRead(token);
			const readAt = new Date().toISOString();
			notifications = notifications.map((notification) => ({ ...notification, read_at: notification.read_at ?? readAt }));
			unreadCount = 0;
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				clearAuthenticatedSession();
				void goto('/');
				return;
			}
			notificationsError = error instanceof ApiError
				? error.message
				: 'Notifikasi belum dapat diperbarui. Coba lagi.';
		} finally {
			markingAllNotifications = false;
		}
	}

	function formatNotificationDate(value: string): string {
		return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
	}

	async function restoreProfile(token: string): Promise<void> {
		if (profileFetchToken === token) return;
		profileFetchToken = token;

		try {
			const profile = await fetchCurrentProfile(token);
			if (activeToken === token) updateProfile(profile);
		} catch (error) {
			if (activeToken === token && error instanceof ApiError && error.status === 401) {
				clearAuthenticatedSession();
				void goto('/');
			}
		} finally {
			if (profileFetchToken === token) profileFetchToken = null;
		}
	}

	function isActive(path: string): boolean {
		if (path === '/requests') return currentPath === path || currentPath.startsWith(`${path}/`);
		return currentPath === path;
	}

	function logout(): void {
		mobileMenuOpen = false;
		clearAuthenticatedSession();
		void goto('/');
	}

	function closeMobileMenu(): void {
		mobileMenuOpen = false;
	}
</script>

{#snippet navigationLinks(mobile: boolean)}
	<Button href="/dashboard" variant={!mobile && isActive('/dashboard') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/dashboard') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
		{#if mobile}<House class="size-5" aria-hidden="true" />{/if}
		<span>Beranda</span>
	</Button>
	{#if role === 'branch_user'}
		<Button href="/requests" variant={!mobile && isActive('/requests') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/requests') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
			<ClipboardList class={mobile ? 'size-5' : 'size-4'} aria-hidden="true" /> <span>Pengajuan</span>
		</Button>
	{:else if role === 'korwil_staff' || role === 'korwil_approver'}
		<Button href="/inbox/korwil" variant={!mobile && isActive('/inbox/korwil') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/inbox/korwil') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
			<Inbox class={mobile ? 'size-5' : 'size-4'} aria-hidden="true" /> <span>Antrean Korwil</span>
		</Button>
	{:else if role === 'division_staff'}
		<Button href="/inbox/central" variant={!mobile && isActive('/inbox/central') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/inbox/central') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
			<Building2 class={mobile ? 'size-5' : 'size-4'} aria-hidden="true" /> <span>Antrean Divisi</span>
		</Button>
	{:else if role === 'admin'}
		<Button href="/admin/users" variant={!mobile && isActive('/admin/users') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/admin/users') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
			{#if mobile}<UsersRound class="size-5" aria-hidden="true" />{/if}
			<span>Pengguna</span>
		</Button>
		<Button href="/admin/master" variant={!mobile && isActive('/admin/master') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/admin/master') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
			{#if mobile}<BriefcaseBusiness class="size-5" aria-hidden="true" />{/if}
			<span>Pekerjaan</span>
		</Button>
		<Button href="/admin/divisions" variant={!mobile && isActive('/admin/divisions') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/admin/divisions') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
			{#if mobile}<Building2 class="size-5" aria-hidden="true" />{/if}
			<span>Divisi</span>
		</Button>
	{/if}
	{#if role === 'management' || role === 'supervisor' || role === 'admin'}
		<Button href="/management/branch-follow-up" variant={!mobile && isActive('/management/branch-follow-up') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/management/branch-follow-up') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
			{#if mobile}<ClipboardList class="size-5" aria-hidden="true" />{/if}
			<span>Tindak lanjut Cabang</span>
		</Button>
	{/if}
{/snippet}

<Dialog.Root bind:open={notificationsOpen}>
<header class="app-navbar">
	<a class="wordmark" href="/dashboard" aria-label="Beranda Sistem SLA Pengajuan">
		<span class="wordmark-mark" aria-hidden="true">S</span>
		<span>Sistem SLA <span class="wordmark-light">Pengajuan</span></span>
	</a>

	<nav class="primary-nav" aria-label="Navigasi utama">
		{@render navigationLinks(false)}
	</nav>

	<div class="navbar-actions" aria-label="Aksi akun">
		<Button variant="ghost" size="icon-lg" class="notification-trigger relative min-h-11 min-w-11 border-0 bg-transparent p-0 shadow-none hover:bg-transparent hover:text-primary dark:hover:bg-transparent" type="button"
			aria-label={unreadCount ? `Notifikasi, ${unreadCount} belum dibaca` : 'Notifikasi'} aria-busy={notificationsLoading} title="Notifikasi" onclick={showNotifications}>
			<Bell class="size-4" aria-hidden="true" />
			{#if unreadCount > 0}<span class="notification-count" aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</span>{/if}
		</Button>
		<Button variant="ghost" size="icon-lg" class="min-h-11 min-w-11 border-0 bg-transparent p-0 shadow-none hover:bg-transparent hover:text-primary dark:hover:bg-transparent" type="button"
			aria-label={$theme === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap'}
			title={$theme === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap'}
			aria-pressed={$theme === 'dark'} onclick={toggleTheme}>
			{#if $theme === 'dark'}<Sun class="size-4" aria-hidden="true" />{:else}<Moon class="size-4" aria-hidden="true" />{/if}
		</Button>
		<Button variant="ghost" size="icon-lg" class="min-h-11 min-w-11 border-0 bg-transparent p-0 shadow-none hover:bg-transparent hover:text-primary dark:hover:bg-transparent" type="button" aria-label="Keluar" title="Keluar" onclick={logout}>
			<LogOut class="size-4" aria-hidden="true" />
		</Button>
	</div>

	<div class="mobile-header-actions">
		<Button variant="ghost" size="icon-lg" class="notification-trigger relative min-h-11 min-w-11 border-0 bg-transparent p-0 shadow-none hover:bg-transparent hover:text-primary dark:hover:bg-transparent" type="button"
			aria-label={unreadCount ? `Notifikasi, ${unreadCount} belum dibaca` : 'Notifikasi'} aria-busy={notificationsLoading} title="Notifikasi" onclick={showNotifications}>
			<Bell class="size-4" aria-hidden="true" />
			{#if unreadCount > 0}<span class="notification-count" aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</span>{/if}
		</Button>
		<Dialog.Root bind:open={mobileMenuOpen}>
		<Dialog.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="ghost" class="mobile-menu-trigger min-h-11 gap-2 border-0 bg-transparent px-2 shadow-none hover:bg-transparent hover:text-primary dark:hover:bg-transparent" aria-label="Menu" title="Menu">
					<Menu class="size-4" aria-hidden="true" />
					<span>Menu</span>
				</Button>
			{/snippet}
		</Dialog.Trigger>

		<Dialog.Content class="mobile-menu-dialog gap-5 p-5" showCloseButton={false}>
			<Dialog.Header class="mobile-menu-header flex-row items-center justify-between gap-3">
				<Dialog.Title class="text-base">Navigasi</Dialog.Title>
				<Dialog.Close>
					{#snippet child({ props })}
						<Button {...props} variant="ghost" size="icon-lg" class="min-h-11 min-w-11 border-0 bg-transparent p-0 shadow-none hover:bg-transparent hover:text-primary dark:hover:bg-transparent" aria-label="Tutup menu navigasi" title="Tutup menu navigasi">
							<X class="size-4" aria-hidden="true" />
						</Button>
					{/snippet}
				</Dialog.Close>
			</Dialog.Header>
			<Dialog.Description class="sr-only">Pilih halaman atau ubah pengaturan akun.</Dialog.Description>

			<nav class="mobile-nav" aria-label="Navigasi utama">
				{@render navigationLinks(true)}
			</nav>

			<div class="mobile-menu-actions" aria-label="Aksi akun">
				<Button variant="ghost" class="mobile-menu-action min-h-11 h-auto min-w-0 justify-center gap-2 whitespace-nowrap px-2" type="button" onclick={toggleTheme}>
					{#if $theme === 'dark'}<Sun class="size-4" aria-hidden="true" /><span>Mode terang</span>{:else}<Moon class="size-4" aria-hidden="true" /><span>Mode gelap</span>{/if}
				</Button>
				<Button variant="ghost" class="mobile-menu-action min-h-11 h-auto min-w-0 justify-center gap-2 whitespace-nowrap px-2" type="button" onclick={logout}>
					<LogOut class="size-4" aria-hidden="true" /><span>Keluar</span>
				</Button>
			</div>
		</Dialog.Content>
		</Dialog.Root>
	</div>
</header>

	<Dialog.Content class="notification-dialog gap-0 p-0 sm:max-w-lg" showCloseButton={false}>
		<Dialog.Header class="notification-header">
			<div>
				<Dialog.Title class="text-base">Notifikasi</Dialog.Title>
				<Dialog.Description>{unreadCount ? `${unreadCount} belum dibaca` : 'Semua sudah terbaca'}</Dialog.Description>
			</div>
			<div class="notification-header-actions">
				{#if unreadCount > 0}
					<Button variant="ghost" class="min-h-11 gap-2 px-2" type="button" disabled={markingAllNotifications} aria-busy={markingAllNotifications} onclick={readAllNotifications}>
						<CheckCheck class="size-4" aria-hidden="true" /><span class="notification-mark-label">Tandai dibaca</span>
					</Button>
				{/if}
				<Dialog.Close>
					{#snippet child({ props })}
						<Button {...props} variant="ghost" size="icon-lg" class="min-h-11 min-w-11 border-0 bg-transparent p-0 shadow-none hover:bg-transparent hover:text-primary dark:hover:bg-transparent" aria-label="Tutup notifikasi" title="Tutup">
							<X class="size-4" aria-hidden="true" />
						</Button>
					{/snippet}
				</Dialog.Close>
			</div>
		</Dialog.Header>
		{#if notificationsError}
			<div class="notification-state" role="alert">
				<p>{notificationsError}</p>
				<Button variant="outline" class="min-h-11" type="button" onclick={() => activeToken && void loadNotifications(activeToken)}>Coba lagi</Button>
			</div>
		{:else if notificationsLoading && notifications.length === 0}
			<p class="notification-state" role="status">Memuat notifikasi…</p>
		{:else if notifications.length === 0}
			<p class="notification-state">Belum ada notifikasi untuk akun ini.</p>
		{:else}
			<ul class="notification-list" aria-label="Daftar notifikasi">
				{#each notifications as item (item.id)}
					<li>
						<button class:unread={item.read_at === null} class="notification-item" type="button" onclick={() => void openNotification(item)}>
							<span class="notification-item-indicator" aria-hidden="true">{#if item.read_at === null}<span></span>{:else}<Check class="size-3" />{/if}</span>
							<span class="notification-item-copy">
								{#if item.read_at === null}<span class="sr-only">Belum dibaca. </span>{/if}
								<span class="notification-item-title">{item.title}</span>
								<span class="notification-item-body">{item.body}</span>
								<time datetime={item.created_at}>{formatNotificationDate(item.created_at)}</time>
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<style>
	.app-navbar {
		position: sticky;
		top: 0;
		z-index: 30;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: center;
		gap: 0.75rem;
		min-height: 4.25rem;
		padding-inline: clamp(1rem, 5vw, 4rem);
		border-bottom: 1px solid var(--border);
		background: var(--background);
	}

	.wordmark {
		display: inline-flex;
		min-width: 0;
		align-items: center;
		justify-self: start;
		gap: 0.6rem;
		color: var(--foreground);
		font-size: var(--type-sm);
		font-weight: 650;
		letter-spacing: -0.02em;
		text-decoration: none;
	}

	.wordmark-mark {
		display: grid;
		width: 1.9rem;
		height: 1.9rem;
		flex: 0 0 auto;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		font-size: var(--type-xs);
	}

	.wordmark-light { color: var(--muted-foreground); font-weight: 450; }
	.wordmark > span:last-child { min-width: 0; overflow-wrap: anywhere; }
	.wordmark:focus-visible { outline: 3px solid var(--ring); outline-offset: 2px; }
	.primary-nav { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0.15rem; }
	.navbar-actions { display: flex; align-items: center; justify-self: end; gap: 0.1rem; }
	.mobile-header-actions { display: none; }
	:global(.notification-trigger) { flex: 0 0 auto; }
	:global(.notification-count) { position: absolute; top: 0.15rem; right: 0.1rem; min-width: 1rem; height: 1rem; padding-inline: 0.18rem; border-radius: 999px; background: var(--destructive); color: var(--destructive-foreground); font-size: 0.625rem; font-weight: 700; line-height: 1rem; text-align: center; }
	:global(.notification-dialog) { width: min(32rem, calc(100vw - 1.5rem)); max-height: min(80dvh, 42rem); overflow: hidden; }
	:global(.notification-header) { display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 1rem 1rem 0.8rem; border-bottom: 1px solid var(--border); }
	.notification-header-actions { display: flex; align-items: center; gap: 0.15rem; }
	.notification-mark-label { white-space: nowrap; }
	.notification-list { max-height: min(65dvh, 34rem); overflow-y: auto; padding: 0.35rem; list-style: none; }
	.notification-list li + li { border-top: 1px solid var(--border); }
	.notification-item { display: grid; grid-template-columns: 1.25rem minmax(0, 1fr); width: 100%; min-height: 4.5rem; align-items: start; gap: 0.55rem; padding: 0.8rem 0.65rem; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
	.notification-item:hover { background: color-mix(in srgb, var(--muted) 55%, transparent); }
	.notification-item:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
	.notification-item-indicator { display: grid; min-height: 1.25rem; place-items: center; color: var(--muted-foreground); }
	.notification-item-indicator > span { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--primary); }
	.notification-item-copy { display: grid; min-width: 0; gap: 0.2rem; }
	.notification-item-title { font-weight: 600; }
	.notification-item-body, .notification-item-copy time { overflow-wrap: anywhere; color: var(--muted-foreground); font-size: var(--type-xs); }
	.notification-state { display: flex; min-height: 8rem; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; padding: 1.25rem; color: var(--muted-foreground); text-align: center; }
	:global(.mobile-menu-trigger) { display: none; }
	.mobile-nav { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.25rem; }
	.mobile-nav :global(a:nth-child(3):last-child) { grid-column: 1 / -1; justify-self: center; width: calc(50% - 0.125rem); }
	.mobile-nav :global(a:only-child) { width: 100%; }
	.mobile-nav :global(a[aria-current='page']) { color: var(--primary); font-weight: 650; }
	.mobile-menu-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; border-top: 1px solid var(--border); padding-top: 0.75rem; }

	@media (max-width: 62rem) {
		.app-navbar { grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: auto auto; row-gap: 0.35rem; padding-block: 0.55rem; }
		.primary-nav { grid-column: 1 / -1; grid-row: 2; justify-content: flex-start; }
		.navbar-actions { grid-column: 2; grid-row: 1; }
		.mobile-header-actions { display: none; }
	}

	@media (max-width: 42rem) {
		.app-navbar { grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: auto; gap: 0 0.45rem; padding: 0.55rem 0.65rem; }
		.wordmark { gap: 0.45rem; font-size: var(--type-xs); }
		.wordmark-mark { width: 1.8rem; height: 1.8rem; }
		.primary-nav, .navbar-actions { display: none; }
		.mobile-header-actions { display: flex; grid-column: 2; grid-row: 1; align-items: center; justify-self: end; gap: 0.1rem; }
		:global(.mobile-menu-trigger) { display: inline-flex; justify-self: end; }
	}

	@media (max-width: 22rem) {
		.mobile-menu-actions { grid-template-columns: 1fr; }
		.mobile-menu-actions :global(.mobile-menu-action) { width: 100%; }
	}

	@media (max-width: 24rem) {
		.notification-mark-label { display: none; }
		:global(.notification-dialog) { padding: 0; }
		:global(.notification-header) { padding-inline: 0.75rem; }
	}
</style>
