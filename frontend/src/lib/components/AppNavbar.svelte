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
	import slaLogoMark from '#lib/assets/favicon.svg';
	import type { AuthenticatedProfile } from '#lib/features/auth/auth.types.js';
	import { formatDateTimeWib } from '#lib/utils/datetime.js';
	import { Bell, BriefcaseBusiness, Building2, Check, CheckCheck, ClipboardList, House, Inbox, LogOut, Menu, Moon, Plus, Sun, UserRound, UsersRound, X } from '@lucide/svelte';
	import {
		fetchNotifications,
		markAllNotificationsRead,
		markNotificationRead,
		type AppNotification
	} from '#lib/features/notifications/notifications.api.js';

	let role = $state<string | null>(null);
	let profile = $state<AuthenticatedProfile | null>(null);
	let canManageForms = $state(false);
	let mobileMenuOpen = $state(false);
	let notificationsOpen = $state(false);
	let profileOpen = $state(false);
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
		profile = session.profile;
		role = session.profile?.sla_access.role ?? null;
		canManageForms = session.profile?.sla_access.can_manage_forms ?? false;
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
		return formatDateTimeWib(value);
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

	function isTabActive(path: string): boolean {
		if (path === '/requests') {
			return currentPath === path || (currentPath.startsWith(`${path}/`) && currentPath !== '/requests/new');
		}
		return isActive(path);
	}

	function isMoreTabActive(): boolean {
		return mobileMenuOpen || (role === 'admin' && ['/admin/master', '/admin/forms', '/admin/divisions'].some(isActive));
	}

	function roleLabel(value: AuthenticatedProfile['sla_access']['role']): string {
		const labels = {
			admin: 'Administrator',
			branch_user: 'Pengguna Cabang',
			korwil_staff: 'Petugas Korwil',
			korwil_approver: 'Penyetuju Korwil',
			division_staff: 'Petugas Divisi Pusat',
			supervisor: 'Supervisor',
			management: 'Manajemen'
		};
		return value ? labels[value] : 'Belum memiliki peran';
	}

	function scopeLabel(value: AuthenticatedProfile['sla_access']['scope']): string {
		const labels = { all: 'Seluruh unit', office: 'Kantor', korwil: 'Korwil', division: 'Divisi Pusat' };
		return value ? labels[value] : 'Belum ditentukan';
	}

	function profileInitials(fullName: string | undefined): string {
		const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
		if (parts.length > 1) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
		return (parts[0]?.slice(0, 2) || 'P').toUpperCase();
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
					<Button href="/dashboard" variant={!mobile && isActive('/dashboard') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link h-auto min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/dashboard') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
		{#if mobile}<House class="size-5" aria-hidden="true" />{/if}
		<span>Beranda</span>
	</Button>
	{#if role === 'branch_user'}
						<Button href="/requests" variant={!mobile && isActive('/requests') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link h-auto min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/requests') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
			<ClipboardList class={mobile ? 'size-5' : 'size-4'} aria-hidden="true" /> <span>Pengajuan</span>
		</Button>
	{:else if role === 'korwil_staff' || role === 'korwil_approver'}
						<Button href="/inbox/korwil" variant={!mobile && isActive('/inbox/korwil') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link h-auto min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/inbox/korwil') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
			<Inbox class={mobile ? 'size-5' : 'size-4'} aria-hidden="true" /> <span>Antrean Korwil</span>
		</Button>
	{:else if role === 'division_staff'}
						<Button href="/inbox/central" variant={!mobile && isActive('/inbox/central') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link h-auto min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/inbox/central') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
			<Building2 class={mobile ? 'size-5' : 'size-4'} aria-hidden="true" /> <span>Antrean Divisi</span>
		</Button>
	{:else if role === 'admin'}
						<Button href="/admin/users" variant={!mobile && isActive('/admin/users') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link h-auto min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/admin/users') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
			{#if mobile}<UsersRound class="size-5" aria-hidden="true" />{/if}
			<span>Pengguna</span>
		</Button>
						<Button href="/admin/master" variant={!mobile && isActive('/admin/master') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link h-auto min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/admin/master') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
			{#if mobile}<BriefcaseBusiness class="size-5" aria-hidden="true" />{/if}
			<span>Pekerjaan</span>
		</Button>
						<Button href="/admin/forms" variant={!mobile && isActive('/admin/forms') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link h-auto min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/admin/forms') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
			{#if mobile}<ClipboardList class="size-5" aria-hidden="true" />{/if}
			<span>Form</span>
		</Button>
						<Button href="/admin/divisions" variant={!mobile && isActive('/admin/divisions') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link h-auto min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/admin/divisions') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
			{#if mobile}<Building2 class="size-5" aria-hidden="true" />{/if}
			<span>Divisi</span>
		</Button>
	{/if}
	{#if role === 'division_staff' && canManageForms}
		<Button href="/admin/forms" variant={!mobile && isActive('/admin/forms') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link h-auto min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/admin/forms') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
			<ClipboardList class={mobile ? 'size-5' : 'size-4'} aria-hidden="true" />
			<span>Kelola Form</span>
		</Button>
	{/if}
	{#if role === 'management' || role === 'supervisor' || role === 'admin'}
						<Button href="/management/branch-follow-up" variant={!mobile && isActive('/management/branch-follow-up') ? 'secondary' : 'ghost'} class={mobile ? 'mobile-nav-link h-auto min-h-20 w-full flex-col gap-2 py-3 text-center' : 'nav-link min-h-11 px-3'} aria-current={isActive('/management/branch-follow-up') ? 'page' : undefined} onclick={mobile ? closeMobileMenu : undefined}>
			{#if mobile}<ClipboardList class="size-5" aria-hidden="true" />{/if}
			<span>Pemantauan tiket</span>
		</Button>
	{/if}
{/snippet}

<Dialog.Root bind:open={notificationsOpen}>
<header class="app-navbar">
	<a class="wordmark" href="/dashboard" aria-label="Beranda SLA Pengajuan, pelacakan pengajuan Cabang, Korwil, dan Pusat">
		<img class="wordmark-mark" src={slaLogoMark} alt="" aria-hidden="true" />
		<span class="wordmark-primary">SLA</span><span class="wordmark-light">Pengajuan</span>
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
		<Button variant="ghost" size="icon-lg" class="profile-trigger min-h-11 min-w-11 border-0 bg-transparent p-0 shadow-none hover:bg-transparent hover:text-primary dark:hover:bg-transparent" type="button" aria-label="Profil pengguna" title="Profil pengguna" onclick={() => (profileOpen = true)}>
			<UserRound class="size-4" aria-hidden="true" />
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
		<Button variant="ghost" size="icon-lg" class="profile-trigger min-h-11 min-w-11 border-0 bg-transparent p-0 shadow-none hover:bg-transparent hover:text-primary dark:hover:bg-transparent" type="button" aria-label="Profil pengguna" title="Profil pengguna" onclick={() => (profileOpen = true)}>
			<UserRound class="size-4" aria-hidden="true" />
		</Button>
		<Dialog.Root bind:open={mobileMenuOpen}>
		<Dialog.Content id="mobile-nav-dialog" class="mobile-menu-dialog gap-5 p-5" showCloseButton={false}>
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

			<div class="mobile-menu-nav-scroll">
				<nav class="mobile-nav" aria-label="Navigasi utama">
					{@render navigationLinks(true)}
				</nav>
			</div>

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

<nav class="mobile-tabbar" aria-label="Navigasi utama">
	<Button href="/dashboard" variant="ghost" class={isActive('/dashboard') ? 'mobile-tab-link mobile-tab-link--active' : 'mobile-tab-link'} aria-current={isActive('/dashboard') ? 'page' : undefined}>
		<House class="size-[1.15rem]" aria-hidden="true" /><span>Beranda</span>
	</Button>
	{#if role === 'branch_user'}
		<Button href="/requests" variant="ghost" class={isTabActive('/requests') ? 'mobile-tab-link mobile-tab-link--active' : 'mobile-tab-link'} aria-current={isTabActive('/requests') ? 'page' : undefined}>
			<ClipboardList class="size-[1.15rem]" aria-hidden="true" /><span>Pengajuan</span>
		</Button>
		<Button href="/requests/new" variant="ghost" class={isActive('/requests/new') ? 'mobile-tab-link mobile-tab-link--create mobile-tab-link--active' : 'mobile-tab-link mobile-tab-link--create'} aria-current={isActive('/requests/new') ? 'page' : undefined}>
			<Plus class="size-[1.15rem]" aria-hidden="true" /><span>Buat</span>
		</Button>
	{:else if role === 'korwil_staff' || role === 'korwil_approver'}
		<Button href="/inbox/korwil" variant="ghost" class={isActive('/inbox/korwil') ? 'mobile-tab-link mobile-tab-link--active' : 'mobile-tab-link'} aria-current={isActive('/inbox/korwil') ? 'page' : undefined}>
			<Inbox class="size-[1.15rem]" aria-hidden="true" /><span>Antrean</span>
		</Button>
	{:else if role === 'division_staff'}
		<Button href="/inbox/central" variant="ghost" class={isActive('/inbox/central') ? 'mobile-tab-link mobile-tab-link--active' : 'mobile-tab-link'} aria-current={isActive('/inbox/central') ? 'page' : undefined}>
			<Building2 class="size-[1.15rem]" aria-hidden="true" /><span>Antrean</span>
		</Button>
		{#if canManageForms}
			<Button href="/admin/forms" variant="ghost" class={isActive('/admin/forms') ? 'mobile-tab-link mobile-tab-link--active' : 'mobile-tab-link'} aria-current={isActive('/admin/forms') ? 'page' : undefined}>
				<ClipboardList class="size-[1.15rem]" aria-hidden="true" /><span>Kelola form</span>
			</Button>
		{/if}
	{:else if role === 'admin'}
		<Button href="/management/branch-follow-up" variant="ghost" class={isActive('/management/branch-follow-up') ? 'mobile-tab-link mobile-tab-link--active' : 'mobile-tab-link'} aria-current={isActive('/management/branch-follow-up') ? 'page' : undefined}>
			<ClipboardList class="size-[1.15rem]" aria-hidden="true" /><span>Pemantauan</span>
		</Button>
		<Button href="/admin/users" variant="ghost" class={isActive('/admin/users') ? 'mobile-tab-link mobile-tab-link--active' : 'mobile-tab-link'} aria-current={isActive('/admin/users') ? 'page' : undefined}>
			<UsersRound class="size-[1.15rem]" aria-hidden="true" /><span>Pengguna</span>
		</Button>
	{:else if role === 'management' || role === 'supervisor'}
		<Button href="/management/branch-follow-up" variant="ghost" class={isActive('/management/branch-follow-up') ? 'mobile-tab-link mobile-tab-link--active' : 'mobile-tab-link'} aria-current={isActive('/management/branch-follow-up') ? 'page' : undefined}>
			<ClipboardList class="size-[1.15rem]" aria-hidden="true" /><span>Pemantauan</span>
		</Button>
	{/if}
	<Button type="button" variant="ghost" class={isMoreTabActive() ? 'mobile-tab-link mobile-tab-link--active' : 'mobile-tab-link'} aria-haspopup="dialog" aria-controls="mobile-nav-dialog" aria-expanded={mobileMenuOpen} onclick={() => (mobileMenuOpen = true)}>
		<Menu class="size-[1.15rem]" aria-hidden="true" /><span>Lainnya</span>
	</Button>
</nav>

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

<Dialog.Root bind:open={profileOpen}>
	<Dialog.Content class="profile-dialog" showCloseButton={false}>
		<Dialog.Header>
			<Dialog.Title>Profil pengguna</Dialog.Title>
			<Dialog.Description>Informasi akun yang sedang masuk ke Sistem SLA.</Dialog.Description>
		</Dialog.Header>
		{#if profile}
			<div class="profile-identity">
				<div class="profile-avatar" aria-hidden="true">{profileInitials(profile.full_name)}</div>
				<div class="profile-identity-copy">
					<strong>{profile.full_name || 'Nama belum tersedia'}</strong>
					<span>ID Pegawai · {profile.employee_id}</span>
				</div>
			</div>
			<dl class="profile-fields">
				<div><dt>Peran</dt><dd>{roleLabel(profile.sla_access.role)}</dd></div>
				<div><dt>Cakupan akses</dt><dd>{scopeLabel(profile.sla_access.scope)}</dd></div>
				{#if profile.branch_name || profile.kode}<div><dt>Kantor</dt><dd>{profile.branch_name ?? `Kode ${profile.kode}`}</dd></div>{/if}
				{#if profile.unit_kerja}<div><dt>Unit kerja</dt><dd>{profile.unit_kerja}</dd></div>{/if}
				{#if profile.job_position}<div><dt>Jabatan</dt><dd>{profile.job_position}</dd></div>{/if}
				{#if profile.email}<div><dt>Email</dt><dd>{profile.email}</dd></div>{/if}
			</dl>
			<div class="profile-actions"><Button variant="outline" class="min-h-11" onclick={() => (profileOpen = false)}>Tutup</Button></div>
		{:else}
			<p class="profile-loading" role="status">Memuat informasi profil…</p>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<style>
	.app-navbar {
		position: sticky;
		top: 0;
		z-index: 30;
		display: grid;
		grid-template-columns: minmax(10rem, 1fr) auto minmax(10rem, 1fr);
		align-items: center;
		gap: 0.75rem;
		min-height: 4.25rem;
		padding-inline: max(clamp(1rem, 4vw, 3rem), calc((100vw - 88rem) / 2));
		border-bottom: 1px solid var(--border);
		background: color-mix(in srgb, var(--background) 93%, transparent);
		box-shadow: 0 1px 0 color-mix(in srgb, var(--foreground) 2%, transparent);
		-webkit-backdrop-filter: blur(14px);
		backdrop-filter: blur(14px);
	}

	.wordmark {
		display: inline-flex;
		min-width: 0;
		align-items: center;
		justify-self: start;
		gap: 0.4rem;
		color: var(--foreground);
		font-size: var(--type-sm);
		font-weight: 650;
		letter-spacing: -0.035em;
		text-decoration: none;
	}

	.wordmark-mark { display: block; width: 1.8rem; height: 1.8rem; flex: 0 0 auto; }
	.wordmark-primary { margin-left: .1rem; }
	.wordmark-light { color: var(--muted-foreground); font-weight: 500; }
	.wordmark > span:last-child { min-width: 0; overflow-wrap: anywhere; }
	.primary-nav { display: flex; min-width: 0; flex-wrap: nowrap; align-items: center; justify-content: center; gap: 0.15rem; padding: .2rem; border: 1px solid var(--border); border-radius: .65rem; background: var(--muted); }
	.primary-nav :global(a) { min-height: 2.3rem; border: 1px solid transparent; border-radius: .45rem; color: var(--muted-foreground); font-size: var(--type-sm); transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease, box-shadow 140ms ease; }
	.primary-nav :global(a:hover) { color: var(--foreground); }
	.primary-nav :global(a[aria-current='page']) { border-color: color-mix(in srgb,var(--ring) 45%,var(--border)); background: color-mix(in srgb,var(--ring) 12%,var(--card)); color: var(--ring); font-weight:650; box-shadow: inset 0 -2px 0 var(--ring), 0 1px 2px rgb(0 0 0 / .06); }
	.navbar-actions { display: flex; align-items: center; justify-self: end; gap: 0.15rem; }
	.navbar-actions :global([data-slot='button']:hover), .mobile-header-actions :global([data-slot='button']:hover) { background: var(--muted); color: var(--foreground); }
	.mobile-header-actions { display: none; }
	:global(.notification-trigger) { flex: 0 0 auto; }
	:global(.notification-count) { position: absolute; top: 0.15rem; right: 0.1rem; min-width: 1rem; height: 1rem; padding-inline: 0.18rem; border-radius: 999px; background: var(--destructive); color: var(--destructive-foreground); font-size: 0.625rem; font-weight: 700; line-height: 1rem; text-align: center; }
	:global(.notification-dialog) { width: min(32rem, calc(100vw - 1.5rem)); max-height: min(80dvh, 42rem); overflow: hidden; }
	:global(.profile-dialog) { width: min(30rem, calc(100vw - 1.5rem)); max-height: min(84dvh, 42rem); overflow-y: auto; }
	.profile-identity { display: grid; grid-template-columns: 3rem minmax(0, 1fr); align-items: center; gap: .85rem; padding: .85rem; border: 1px solid var(--border); border-radius: .65rem; background: var(--muted); }
	.profile-avatar { display: grid; width: 3rem; height: 3rem; place-items: center; border-radius: 50%; background: var(--accent); color: var(--accent-foreground); font-size: var(--type-base); font-weight: 700; }
	.profile-identity-copy { display: grid; min-width: 0; gap: .2rem; }
	.profile-identity-copy strong { overflow-wrap: anywhere; font-size: var(--type-base); }
	.profile-identity-copy span { color: var(--muted-foreground); font-size: var(--type-xs); }
	.profile-fields { display: grid; margin: 0; }
	.profile-fields > div { display: grid; grid-template-columns: minmax(7rem, .7fr) minmax(0, 1.3fr); gap: .75rem; padding: .65rem 0; border-bottom: 1px solid var(--border); }
	.profile-fields > div:last-child { border-bottom: 0; }
	.profile-fields dt { color: var(--muted-foreground); font-size: var(--type-sm); }
	.profile-fields dd { min-width: 0; margin: 0; overflow-wrap: anywhere; font-size: var(--type-sm); }
	.profile-actions { display: flex; justify-content: flex-end; }
	.profile-loading { margin: .25rem 0; color: var(--muted-foreground); font-size: var(--type-sm); }
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
	.mobile-tabbar { display: none; }
	.mobile-menu-nav-scroll { min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
	.mobile-nav { display: grid; grid-auto-rows: minmax(4.5rem, auto); grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; align-content: start; }
	.mobile-nav :global(a) { border: 1px solid var(--border); border-radius: .7rem; background: var(--card); color: var(--foreground); transition: border-color 140ms ease, background-color 140ms ease, transform 140ms ease; }
	.mobile-nav :global(a:hover) { background: var(--muted); }
	.mobile-nav :global(a:active) { transform: translateY(1px); }
	.mobile-nav :global(a:nth-child(3):last-child) { grid-column: 1 / -1; justify-self: center; width: calc(50% - 0.125rem); }
	.mobile-nav :global(a:nth-child(5):last-child) { grid-column: 1 / -1; justify-self: stretch; width: 100%; }
	.mobile-nav :global(a:only-child) { width: 100%; }
	.mobile-nav :global(a[aria-current='page']) { background: color-mix(in srgb,var(--ring) 16%,var(--card)); color: var(--ring); font-weight: 650; box-shadow: inset 3px 0 0 var(--ring); }
	.mobile-menu-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.55rem; border-top: 1px solid var(--border); padding-top: 0.75rem; }
	.mobile-menu-actions :global(.mobile-menu-action) { min-height: 2.9rem; border: 1px solid var(--border); border-radius: .65rem; background: var(--muted); color: var(--foreground); }
	.mobile-menu-actions :global(.mobile-menu-action:hover) { border-color: color-mix(in srgb,var(--ring) 42%,var(--border)); background: color-mix(in srgb,var(--ring) 8%,var(--muted)); }
	:global(.mobile-menu-dialog) { display: grid; grid-template-rows: auto minmax(0,1fr) auto; gap: .85rem; width: min(29rem, calc(100vw - 1rem)); max-height: min(84dvh, 42rem); overflow: hidden; }

	@media (max-width: 72rem) {
		.app-navbar { grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: auto; gap: 0 0.45rem; min-height: calc(3.8rem + env(safe-area-inset-top)); padding: calc(0.45rem + env(safe-area-inset-top)) max(.75rem, env(safe-area-inset-right)) 0.45rem max(.75rem, env(safe-area-inset-left)); }
		.wordmark { gap: 0.45rem; font-size: var(--type-sm); }
		.primary-nav, .navbar-actions { display: none; }
		.mobile-header-actions { display: flex; grid-column: 2; grid-row: 1; align-items: center; justify-self: end; gap: 0.1rem; }
		:global(.mobile-menu-trigger) { display: none; }
		.mobile-tabbar {
			position: fixed;
			inset-inline: 0;
			bottom: 0;
			z-index: 30;
			display: grid;
			grid-auto-flow: column;
			grid-auto-columns: minmax(0, 1fr);
			align-items: stretch;
			gap: 0.2rem;
			padding-block: 0.35rem calc(0.35rem + env(safe-area-inset-bottom));
			padding-right: max(0.45rem, env(safe-area-inset-right));
			padding-left: max(0.45rem, env(safe-area-inset-left));
			border-top: 1px solid var(--border);
			background: var(--background);
		}
		.mobile-tabbar :global(.mobile-tab-link) {
			display: flex;
			min-width: 0;
			min-height: 3.35rem;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 0.18rem;
			padding: 0.22rem 0.12rem;
			border: 0;
			border-radius: 0.65rem;
			background: transparent;
			color: var(--muted-foreground);
			font-size: 0.68rem;
			line-height: 1.1;
			text-align: center;
			white-space: nowrap;
		}
		.mobile-tabbar :global(.mobile-tab-link:hover) { background: var(--muted); color: var(--foreground); }
		.mobile-tabbar :global(.mobile-tab-link--active) { background: color-mix(in srgb,var(--ring) 16%,var(--card)); color: var(--ring); font-weight: 650; box-shadow: inset 0 -2px 0 var(--ring); }
		.mobile-tabbar :global(.mobile-tab-link--create) { background: var(--foreground); color: var(--background); font-weight: 620; }
		.mobile-tabbar :global(.mobile-tab-link--create:hover) { background: var(--muted); color: var(--foreground); }
		.mobile-tabbar :global(.mobile-tab-link--create.mobile-tab-link--active) { background: color-mix(in srgb,var(--ring) 16%,var(--card)); color: var(--ring); box-shadow: inset 0 -2px 0 var(--ring); }
		.mobile-tabbar :global(.mobile-tab-link > span) { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
	}

	@media (max-width: 22rem) {
		.wordmark-light { display: none; }
		.mobile-menu-actions { gap: .35rem; }
		.mobile-menu-actions :global(.mobile-menu-action) { padding-inline: .35rem; font-size: var(--type-xs); }
	}

	@media (max-width: 24rem) {
		.notification-mark-label { display: none; }
		:global(.notification-dialog) { padding: 0; }
		:global(.notification-header) { padding-inline: 0.75rem; }
	}

	@media (max-width: 42rem) {
		:global(.mobile-menu-dialog[data-slot='dialog-content']),
		:global(.notification-dialog[data-slot='dialog-content']),
		:global(.profile-dialog[data-slot='dialog-content']) {
			top: auto;
			right: 0;
			bottom: 0;
			left: 0;
			width: 100%;
			max-width: none;
			max-height: min(84dvh, 42rem);
			margin: 0;
			transform: none;
			translate: 0 0;
			border-radius: 1rem 1rem 0 0;
			padding-bottom: calc(.85rem + env(safe-area-inset-bottom));
		}
		:global(.mobile-menu-dialog[data-slot='dialog-content']) { grid-template-rows: auto minmax(0,1fr) auto; overflow: hidden; }
		.mobile-menu-nav-scroll { overscroll-behavior: contain; }
	}
</style>
