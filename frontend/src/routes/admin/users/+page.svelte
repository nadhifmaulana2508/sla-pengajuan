<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ApiError } from '#lib/api/client.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import SearchableSelect from '#lib/components/SearchableSelect.svelte';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import AppNavbar from '#lib/components/AppNavbar.svelte';
	import AppPageHeading from '#lib/components/AppPageHeading.svelte';
	import { Pencil, Plus, Search, Trash2, UsersRound, X } from '@lucide/svelte';
	import {
		fetchAdminUsersWorkspace,
		updateAdminUserAccess,
		type AdminAccessDivision,
		type AdminAccessOffice,
		type AdminAccessRole,
		type AdminScopeType,
		type AdminUser,
		type AdminUserAssignmentInput
	} from '#lib/features/admin/admin.api.js';
	import {
		authSession,
		clearAuthenticatedSession,
		updateProfile
	} from '#lib/features/auth/auth.store.js';

	type AssignmentForm = {
		key: number;
		role_id: string;
		scope_type: AdminScopeType;
		kode_kantor: string;
		korwil: string;
		divisi_id: string;
		can_manage_forms: boolean;
	};

	type ScopeItem = { value: AdminScopeType; label: string };

	const scopeItems: ScopeItem[] = [
		{ value: 'global', label: 'Seluruh sistem' },
		{ value: 'office', label: 'Satu kantor' },
		{ value: 'korwil', label: 'Satu Korwil' },
		{ value: 'division', label: 'Satu divisi pusat' }
	];
	const korwilLabels: Record<string, string> = {
		semarang: 'Semarang Raya',
		solo: 'Solo Raya',
		banyumas: 'Banyumas Raya',
		pekalongan: 'Pekalongan Raya'
	};
	let nextAssignmentKey = 1;

	let users = $state<AdminUser[]>([]);
	let roles = $state<AdminAccessRole[]>([]);
	let offices = $state<AdminAccessOffice[]>([]);
	let korwils = $state<string[]>([]);
	let divisions = $state<AdminAccessDivision[]>([]);
	let isLoading = $state(true);
	let isSaving = $state(false);
	let loadError = $state('');
	let formError = $state('');
	let statusMessage = $state('');
	let searchQuery = $state('');
	let selectedUser = $state<AdminUser | null>(null);
	let accessDialogOpen = $state(false);
	let isActive = $state(false);
	let assignments = $state<AssignmentForm[]>([]);

	let filteredUsers = $derived.by(() => {
		const query = searchQuery.trim().toLocaleLowerCase('id-ID');
		if (!query) return users;
		return users.filter((user) => [
			user.employee_id,
			user.full_name,
			user.branch_name,
			user.unit_kerja,
			user.nama_kantor
		].filter(Boolean).join(' ').toLocaleLowerCase('id-ID').includes(query));
	});
	let roleItems = $derived(roles.map((role) => ({ value: String(role.id), label: role.nama_role })));
	let currentEmployeeId = $derived($authSession.profile?.employee_id ?? '');

	$effect(() => {
		if (!accessDialogOpen && selectedUser) {
			selectedUser = null;
			assignments = [];
			formError = '';
		}
	});

	onMount(() => {
		let token: string | null = null;
		const unsubscribe = authSession.subscribe((session) => {
			token = session.token;
		});
		void loadAdminData(() => token);
		return unsubscribe;
	});

	async function loadAdminData(readToken: () => string | null): Promise<void> {
		const token = readToken();
		if (!token) {
			await goto('/');
			return;
		}

		isLoading = true;
		loadError = '';
		try {
			const workspace = await fetchAdminUsersWorkspace(token);
			updateProfile(workspace.profile);
			if (workspace.profile.sla_access.role !== 'admin' || workspace.profile.sla_access.scope !== 'all') {
				await goto('/dashboard');
				return;
			}
			users = workspace.users;
			roles = workspace.roles;
			offices = workspace.offices;
			korwils = workspace.korwils;
			divisions = workspace.divisions;
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				clearAuthenticatedSession();
				await goto('/');
				return;
			}
			if (error instanceof ApiError && error.status === 403) {
				await goto('/dashboard');
				return;
			}
			loadError = error instanceof ApiError
				? error.message
				: 'Data pengguna belum dapat dimuat. Periksa koneksi lalu coba lagi.';
		} finally {
			isLoading = false;
		}
	}

	function blankAssignment(): AssignmentForm {
		return {
			key: nextAssignmentKey++,
			role_id: '',
			scope_type: 'global',
			kode_kantor: '',
			korwil: '',
			divisi_id: '',
			can_manage_forms: false
		};
	}

	function requiredScope(roleCode: string): AdminScopeType | null {
		const byRole: Record<string, AdminScopeType> = {
			admin: 'global',
			branch_user: 'office',
			korwil_staff: 'korwil',
			korwil_approver: 'korwil',
			division_staff: 'division'
		};
		return byRole[roleCode] ?? null;
	}

	function roleCode(assignment: AssignmentForm): string | null {
		return roles.find((item) => String(item.id) === assignment.role_id)?.kode ?? null;
	}

	function usesAutomaticScope(assignment: AssignmentForm): boolean {
		return ['admin', 'branch_user', 'korwil_staff', 'korwil_approver', 'division_staff'].includes(roleCode(assignment) ?? '');
	}

	function automaticScopeInfo(assignment: AssignmentForm): { target: string; help: string; ready: boolean } {
		const code = roleCode(assignment);
		if (code === 'admin') return { target: 'Seluruh sistem', help: 'Akses Admin berlaku untuk semua fitur.', ready: true };
		if (code === 'branch_user') {
			if (selectedUser?.kode_kantor && selectedUser.kode_kantor !== '000' && selectedUser.nama_kantor) {
				return { target: `${selectedUser.kode_kantor} · ${selectedUser.nama_kantor}`, help: 'Mengikuti kantor aktif pada profil SSO. Pengajuan tetap tercatat pada kantor ini saat pegawai berganti.', ready: true };
			}
			return { target: 'Kantor belum terpetakan', help: 'Periksa kode kantor pada profil SSO dan statusnya di Master Kantor.', ready: false };
		}
		if (code === 'korwil_staff' || code === 'korwil_approver') {
			const korwil = selectedUser?.sso_korwil;
			return korwil
				? { target: korwilLabels[korwil] ?? korwil, help: 'Mengikuti wilayah pada profil organisasi SSO.', ready: true }
				: { target: 'Korwil belum terpetakan', help: 'Periksa unit kerja, kantor, dan jabatan pada profil organisasi SSO.', ready: false };
		}
		if (code === 'division_staff') {
			return selectedUser?.nama_divisi
				? { target: selectedUser.nama_divisi, help: 'Mengikuti unit kerja terbaru pada profil SSO.', ready: true }
				: { target: 'Divisi belum terpetakan', help: 'Tambahkan alias unit kerja SSO di Master Divisi, lalu muat ulang daftar pegawai.', ready: false };
		}
		return { target: '', help: '', ready: false };
	}

	function editUser(user: AdminUser): void {
		selectedUser = user;
		accessDialogOpen = true;
		isActive = user.is_active;
		assignments = user.assignments.length
			? user.assignments.map((assignment) => ({
				key: nextAssignmentKey++,
				role_id: String(assignment.role_id),
				scope_type: assignment.scope_type,
				kode_kantor: assignment.kode_kantor ?? '',
				korwil: assignment.korwil ?? '',
				divisi_id: assignment.divisi_id === null ? '' : String(assignment.divisi_id),
				can_manage_forms: assignment.can_manage_forms
			}))
			: [blankAssignment()];
		formError = '';
		statusMessage = '';
	}

	function changeRole(assignment: AssignmentForm, roleId: string): void {
		assignment.role_id = roleId;
		const role = roles.find((item) => String(item.id) === roleId);
		const scope = role ? requiredScope(role.kode) : null;
		if (scope) assignment.scope_type = scope;
		assignment.kode_kantor = '';
		assignment.korwil = '';
		assignment.divisi_id = '';
		assignment.can_manage_forms = false;
	}

	function followsSsoOffice(assignment: AssignmentForm): boolean {
		const role = roles.find((item) => String(item.id) === assignment.role_id);
		return role?.kode === 'branch_user';
	}

	function changeScope(assignment: AssignmentForm, scope: AdminScopeType): void {
		assignment.scope_type = scope;
		assignment.kode_kantor = '';
		assignment.korwil = '';
		assignment.divisi_id = '';
	}

	function availableScopes(assignment: AssignmentForm): ScopeItem[] {
		const role = roles.find((item) => String(item.id) === assignment.role_id);
		const required = role ? requiredScope(role.kode) : null;
		return required ? scopeItems.filter((scope) => scope.value === required) : scopeItems;
	}

	function officeItems(assignment: AssignmentForm) {
		const role = roles.find((item) => String(item.id) === assignment.role_id);
		return offices
			.filter((office) => role?.kode !== 'branch_user' || office.kode_kantor !== '000')
			.map((office) => ({
				value: office.kode_kantor,
				label: `${office.kode_kantor} · ${office.nama_kantor}`
			}));
	}

	function scopeSummary(assignment: AdminUser['assignments'][number], user?: AdminUser): string {
		if (assignment.role_code === 'admin' || assignment.scope_type === 'global') return 'Seluruh sistem';
		if (assignment.scope_type === 'office') {
			if (assignment.role_code === 'branch_user') {
				if (!user?.kode_kantor || !user.nama_kantor) return 'Mengikuti kantor SSO';
				return `${user.kode_kantor} · ${user.nama_kantor}`;
			}
			return assignment.nama_kantor ? `${assignment.kode_kantor} · ${assignment.nama_kantor}` : 'Kantor';
		}
		if (assignment.scope_type === 'korwil') {
			const korwil = assignment.role_code.startsWith('korwil_') ? user?.sso_korwil : assignment.korwil;
			return korwil ? korwilLabels[korwil] ?? korwil : 'Korwil belum terpetakan dari SSO';
		}
		if (assignment.role_code === 'division_staff') return user?.nama_divisi ?? 'Divisi belum terpetakan dari SSO';
		return assignment.nama_divisi ?? 'Divisi Pusat';
	}

	function serializeAssignments(): AdminUserAssignmentInput[] | null {
		const result: AdminUserAssignmentInput[] = [];
		for (const assignment of assignments) {
			if (!assignment.role_id) {
				formError = 'Pilih peran pada setiap baris atau hapus baris yang tidak digunakan.';
				return null;
			}
			const entry: AdminUserAssignmentInput = {
				role_id: Number(assignment.role_id),
				scope_type: assignment.scope_type,
				kode_kantor: null,
				korwil: null,
				divisi_id: null,
				can_manage_forms: assignment.can_manage_forms
			};
			if (assignment.scope_type === 'office') {
				if (followsSsoOffice(assignment)) {
					if (!selectedUser?.kode_kantor || selectedUser.kode_kantor === '000') {
						formError = 'Profil SSO pegawai belum menunjukkan kantor Cabang yang aktif.';
						return null;
					}
				} else if (!assignment.kode_kantor) {
					formError = 'Pilih kantor untuk cakupan kantor.';
					return null;
				} else {
					entry.kode_kantor = assignment.kode_kantor;
				}
			} else if (assignment.scope_type === 'korwil') {
				if (['korwil_staff', 'korwil_approver'].includes(roleCode(assignment) ?? '')) {
					if (!selectedUser?.sso_korwil) {
						formError = 'Profil SSO pegawai belum menunjukkan Korwil yang terdaftar.';
						return null;
					}
				} else if (!assignment.korwil) {
					formError = 'Pilih Korwil untuk cakupan Korwil.';
					return null;
				} else {
					entry.korwil = assignment.korwil;
				}
			} else if (assignment.scope_type === 'division') {
				if (roleCode(assignment) === 'division_staff') {
					if (!selectedUser?.divisi_id) {
						formError = 'Unit kerja SSO belum cocok dengan Master Divisi. Tambahkan alias unit kerja, lalu muat ulang daftar pegawai.';
						return null;
					}
				} else if (!assignment.divisi_id) {
					formError = 'Pilih divisi untuk cakupan Divisi Pusat.';
					return null;
				} else {
					entry.divisi_id = Number(assignment.divisi_id);
				}
			}
			result.push(entry);
		}
		if (isActive && result.length === 0) {
			formError = 'Akun aktif harus memiliki setidaknya satu peran dan cakupan.';
			return null;
		}
		return result;
	}

	async function saveAccess(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!selectedUser || isSaving || selectedUser.employee_id === currentEmployeeId) return;
		formError = '';
		const serialized = serializeAssignments();
		if (!serialized) return;
		const token = $authSession.token;
		if (!token) {
			clearAuthenticatedSession();
			await goto('/');
			return;
		}

		isSaving = true;
		statusMessage = '';
		try {
			const result = await updateAdminUserAccess(token, selectedUser.id, {
				is_active: isActive,
				assignments: serialized
			});
			statusMessage = result.message;
			closeEditor();
			await loadAdminData(() => token);
		} catch (error) {
			formError = error instanceof ApiError
				? error.message
				: 'Perubahan belum tersimpan. Periksa koneksi lalu coba lagi.';
		} finally {
			isSaving = false;
		}
	}

	function closeEditor(): void {
		accessDialogOpen = false;
		selectedUser = null;
		assignments = [];
		formError = '';
	}

</script>

<svelte:head>
	<title>Pengguna | Sistem SLA Pengajuan</title>
	<meta name="description" content="Aktifkan pegawai dan atur peran serta cakupan akses Sistem SLA." />
</svelte:head>

<main id="main-content" class="admin-page">
	<AppNavbar />

	<section class="admin-content app-page-shell" aria-labelledby="page-title">
		<AppPageHeading eyebrow="Administrasi" title="Akses pegawai" description="Atur peran pegawai. Cakupan Cabang, Korwil, dan Divisi Pusat mengikuti profil SSO." />

		{#if statusMessage}
			<p class="save-status" role="status" aria-live="polite">{statusMessage}</p>
		{/if}

		<Dialog.Root bind:open={accessDialogOpen}>
			{#if selectedUser}
				<Dialog.Content class="access-dialog" showCloseButton={false}>
					<Dialog.Header class="access-dialog-header">
						<div class="access-dialog-heading">
							<Dialog.Title class="access-dialog-title">Atur akses pegawai</Dialog.Title>
							<Dialog.Description>{selectedUser.full_name || 'Nama belum tersinkron'} · {selectedUser.employee_id}</Dialog.Description>
						</div>
						<Button type="button" variant="ghost" size="icon-lg" class="min-h-11 min-w-11 border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground dark:hover:bg-transparent" aria-label="Tutup pengaturan akses" title="Tutup" onclick={closeEditor}>
							<X class="size-4" aria-hidden="true" />
						</Button>
					</Dialog.Header>
					<div class="access-dialog-body">
					{#if selectedUser.employee_id === currentEmployeeId}
						<Alert.Root>
							<Alert.Title>Akun admin yang sedang digunakan</Alert.Title>
							<Alert.Description>Untuk mencegah akses admin terkunci, akun ini tidak dapat diubah dari sesinya sendiri.</Alert.Description>
						</Alert.Root>
					{:else}
						<form class="access-form" onsubmit={saveAccess}>
							<div class="user-summary">
								<span>{selectedUser.nama_kantor || selectedUser.branch_name || 'Kantor belum terpetakan'}</span>
								<span>{selectedUser.unit_kerja || 'Unit kerja belum tercantum'}</span>
							</div>
							<div class="active-control">
								<Checkbox id="user-active" bind:checked={isActive} class="size-5 after:-inset-y-3" aria-describedby="active-help" />
								<div class="active-copy">
									<Label for="user-active" class="active-label">Akun aktif</Label>
									<p id="active-help">Jika dimatikan, pegawai tidak dapat masuk ke proses SLA.</p>
								</div>
							</div>

							<div class="assignment-heading">
								<div>
									<h3>Peran</h3>
									<p>Cakupan Cabang, Korwil, dan Divisi mengikuti profil SSO. Cakupan khusus Supervisor atau Manajemen tetap perlu ditentukan.</p>
								</div>
								<Button type="button" variant="outline" size="lg" class="min-h-11 border-input" onclick={() => assignments = [...assignments, blankAssignment()]}>
									<Plus class="size-4" aria-hidden="true" /> Tambah peran
								</Button>
							</div>

							{#each assignments as assignment, index (assignment.key)}
								<div class="assignment-row" class:automatic-assignment={usesAutomaticScope(assignment)}>
									<div class="field-group">
										<Label for={`role-${assignment.key}`}>Peran</Label>
						<SearchableSelect id={`role-${assignment.key}`} label="Peran" options={roleItems} value={assignment.role_id} onValueChange={(value) => changeRole(assignment, value)} placeholder="Pilih peran" searchPlaceholder="Cari peran..." />
									</div>
					{#if usesAutomaticScope(assignment)}
						{@const scopeInfo = automaticScopeInfo(assignment)}
						<div class="scope-note" class:scope-unmapped={!scopeInfo.ready}>
							<span>Cakupan otomatis</span>
							<strong>{scopeInfo.target}</strong>
							<p>{scopeInfo.help}</p>
							{#if roleCode(assignment) === 'division_staff'}
								<div class="form-manager-permission">
									<Checkbox id={`manage-forms-${assignment.key}`} bind:checked={assignment.can_manage_forms} class="size-5 after:-inset-y-3" />
									<div>
										<Label for={`manage-forms-${assignment.key}`}>Boleh mengelola dan menerbitkan form</Label>
										<p>Izin ini hanya berlaku untuk divisi yang cocok dengan profil SSO.</p>
									</div>
								</div>
							{/if}
						</div>
					{:else}
						<div class="field-group">
							<Label for={`scope-${assignment.key}`}>Cakupan</Label>
							<SearchableSelect id={`scope-${assignment.key}`} label="Cakupan" options={availableScopes(assignment)} value={assignment.scope_type} onValueChange={(value) => changeScope(assignment, value as AdminScopeType)} placeholder="Pilih cakupan" searchPlaceholder="Cari cakupan..." />
						</div>
					{/if}

					{#if !usesAutomaticScope(assignment) && assignment.scope_type === 'office'}
										<div class="field-group target-field">
											<Label for={`office-${assignment.key}`}>Kantor</Label>
							<SearchableSelect id={`office-${assignment.key}`} label="Kantor" options={officeItems(assignment)} value={assignment.kode_kantor} onValueChange={(value) => (assignment.kode_kantor = value)} placeholder="Pilih kantor" searchPlaceholder="Cari kode atau nama kantor..." />
										</div>
					{:else if !usesAutomaticScope(assignment) && assignment.scope_type === 'korwil'}
										<div class="field-group target-field">
											<Label for={`korwil-${assignment.key}`}>Korwil</Label>
							<SearchableSelect id={`korwil-${assignment.key}`} label="Korwil" options={korwils.map((value) => ({ value, label: korwilLabels[value] ?? value }))} value={assignment.korwil} onValueChange={(value) => (assignment.korwil = value)} placeholder="Pilih Korwil" searchPlaceholder="Cari Korwil..." />
										</div>
					{:else if !usesAutomaticScope(assignment) && assignment.scope_type === 'division'}
										<div class="field-group target-field">
											<Label for={`division-${assignment.key}`}>Divisi Pusat</Label>
							<SearchableSelect id={`division-${assignment.key}`} label="Divisi Pusat" options={divisions.map((division) => ({ value: String(division.id), label: division.nama_divisi }))} value={assignment.divisi_id} onValueChange={(value) => (assignment.divisi_id = value)} placeholder="Pilih divisi" searchPlaceholder="Cari divisi..." />
										</div>
									{/if}

									<Button type="button" variant="ghost" size="icon-lg" class="remove-assignment min-h-11 min-w-11 border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-destructive dark:hover:bg-transparent" aria-label={`Hapus baris peran ${index + 1}`} title="Hapus peran" onclick={() => assignments = assignments.filter((item) => item.key !== assignment.key)}>
										<Trash2 class="size-4" aria-hidden="true" />
									</Button>
								</div>
							{/each}

							{#if formError}
								<Alert.Root variant="destructive">
									<Alert.Title>Akses belum tersimpan</Alert.Title>
									<Alert.Description>{formError}</Alert.Description>
								</Alert.Root>
							{/if}

							<div class="form-actions">
								<Button type="button" variant="outline" size="lg" class="min-h-11 border-input" onclick={closeEditor}>Batal</Button>
								<Button type="submit" size="lg" class="min-h-11" disabled={isSaving}>
									{isSaving ? 'Menyimpan...' : 'Simpan akses'}
								</Button>
							</div>
						</form>
					{/if}
					</div>
				</Dialog.Content>
			{/if}
		</Dialog.Root>

		<Card.Root size="sm" class="users-card" aria-labelledby="users-title">
			<Card.Header class="users-header">
				<div class="users-heading">
					<UsersRound class="list-heading-icon" aria-hidden="true" />
					<div class="list-heading-copy">
						<Card.Title id="users-title">Daftar pegawai</Card.Title>
						<Card.Description>
							{#if isLoading}Sedang memuat data pegawai.{:else}Profil muncul setelah pegawai login SSO setidaknya sekali.{/if}
						</Card.Description>
					</div>
				</div>
				{#if !isLoading && !loadError}<Badge variant="secondary">{users.filter((user) => user.is_active).length} aktif</Badge>{/if}
			</Card.Header>
			<Card.Content class="users-content">
				<div class="users-toolbar">
					<div class="search-field">
						<Label for="user-search" class="sr-only">Cari pegawai</Label>
						<div class="search-control">
							<Search class="search-icon" aria-hidden="true" />
							<Input id="user-search" bind:value={searchQuery} placeholder="Cari nama, ID, kantor, atau unit kerja" class="min-h-11 border-input" />
						</div>
					</div>
					{#if !isLoading && !loadError}<p class="result-count">{filteredUsers.length} pegawai</p>{/if}
				</div>
				<Separator class="list-separator" />
				{#if isLoading}
					<div class="state-panel" role="status" aria-live="polite"><strong>Memuat pengguna</strong><p>Profil pegawai dan assignment akses sedang diambil dari database.</p></div>
				{:else if loadError}
					<Alert.Root variant="destructive" class="load-error">
						<Alert.Title>Data pengguna belum dapat dimuat</Alert.Title>
						<Alert.Description>{loadError}</Alert.Description>
						<Button variant="outline" size="lg" class="min-h-11 border-input" onclick={() => void loadAdminData(() => $authSession.token)}>Coba lagi</Button>
					</Alert.Root>
				{:else if filteredUsers.length === 0}
					<div class="state-panel empty-panel">
						<strong>{users.length ? 'Tidak ada pegawai yang cocok' : 'Belum ada profil pegawai'}</strong>
						<p>{users.length ? 'Ubah kata pencarian untuk melihat akun lain.' : 'Akun akan muncul di sini setelah pegawai masuk dengan SSO. Setelah itu, Admin dapat menetapkan status, peran, dan cakupannya.'}</p>
					</div>
				{:else}
					<div class="desktop-users">
						<Table.Root label="Daftar pegawai dan akses" tableClass="min-w-[58rem]">
							<caption class="sr-only">Status akun dan akses Sistem SLA per pegawai</caption>
							<thead><tr><th scope="col">Pegawai</th><th scope="col">Unit</th><th scope="col">Akses</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Tindakan</span></th></tr></thead>
							<tbody>
								{#each filteredUsers as user (user.id)}
									<tr>
										<th scope="row"><strong>{user.full_name || 'Nama belum tersinkron'}</strong><small>{user.employee_id}</small></th>
										<td>{user.nama_kantor || user.branch_name || 'Kantor belum terpetakan'}<small>{user.unit_kerja || 'Unit kerja belum tercantum'}</small></td>
						<td>{#if user.assignments.length}<div class="assignment-summary">{#each user.assignments as assignment (assignment.id)}<span>{assignment.role_name} · {scopeSummary(assignment, user)}</span>{/each}</div>{:else}<span class="muted-value">Belum diberi peran</span>{/if}</td>
										<td><Badge variant={user.is_active ? 'secondary' : 'outline'} class={user.is_active ? 'status-badge status-badge--success' : ''}>{user.is_active ? 'Aktif' : 'Nonaktif'}</Badge></td>
						<td class="action-cell">
							{#if user.employee_id === currentEmployeeId}
								<Badge variant="outline">Sesi admin ini</Badge>
							{:else}
								<Button variant="outline" size="lg" class="min-h-11 border-input" onclick={() => editUser(user)}><Pencil class="size-4" aria-hidden="true" /> Atur akses</Button>
							{/if}
						</td>
									</tr>
								{/each}
							</tbody>
						</Table.Root>
					</div>
					<div class="mobile-users">
						{#each filteredUsers as user (user.id)}
							<Card.Root size="sm" class="user-record" role="article" aria-labelledby={`user-record-${user.id}`}>
								<Card.Content class="user-record-content">
								<div class="user-record-heading">
									<div><h3 id={`user-record-${user.id}`}>{user.full_name || 'Nama belum tersinkron'}</h3><p>{user.employee_id}</p></div>
									<Badge variant={user.is_active ? 'secondary' : 'outline'} class={user.is_active ? 'status-badge status-badge--success' : ''}>{user.is_active ? 'Aktif' : 'Nonaktif'}</Badge>
								</div>
								<p class="user-unit">{user.nama_kantor || user.branch_name || 'Kantor belum terpetakan'} · {user.unit_kerja || 'Unit kerja belum tercantum'}</p>
				<div class="assignment-summary">{#if user.assignments.length}{#each user.assignments as assignment (assignment.id)}<span>{assignment.role_name} · {scopeSummary(assignment, user)}</span>{/each}{:else}<span class="muted-value">Belum diberi peran</span>{/if}</div>
				{#if user.employee_id === currentEmployeeId}
					<p class="current-session-note">Akun admin yang sedang dipakai tidak dapat diubah dari sesinya sendiri.</p>
				{:else}
					<Button variant="outline" size="lg" class="min-h-11 w-full border-input" onclick={() => editUser(user)}><Pencil class="size-4" aria-hidden="true" /> Atur akses</Button>
				{/if}
								</Card.Content>
							</Card.Root>
						{/each}
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	</section>
</main>

<style>
	.admin-page { min-height: 100svh; background: var(--muted); color: var(--foreground); }
	.admin-content { display: grid; align-content: start; grid-auto-rows: max-content; gap: 1rem; height: auto; min-height: 0; }
	:global(.admin-content > .app-page-heading) { margin-bottom: 0; }
	.users-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
	.search-field, .field-group { display: grid; min-width: 0; gap: 0.45rem; }
	.search-field { width: min(100%, 32rem); }
	.search-control { position: relative; min-width: 0; }
	.search-control :global(input) { padding-left: 2.5rem; }
	:global(.search-icon) { position: absolute; z-index: 1; top: 50%; left: 0.8rem; width: 1rem; height: 1rem; color: var(--muted-foreground); transform: translateY(-50%); pointer-events: none; }
	.result-count { margin: 0; color: var(--muted-foreground); font-size: var(--type-sm); font-variant-numeric: tabular-nums; white-space: nowrap; }
	.save-status { margin: 0 0 0.8rem; color: var(--foreground); font-size: var(--type-base); }
	:global(.users-card) { min-width: 0; margin-top: 0; }
	:global(.access-dialog) { width: min(52rem, calc(100vw - 2rem)); max-width: min(52rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); overflow-y: auto; }
	:global(.access-dialog-header) { display: flex; flex-direction: row; align-items: flex-start; justify-content: space-between; gap: 1rem; padding-right: 0; }
	:global(.access-dialog-heading) { display: grid; min-width: 0; gap: 0.4rem; }
	:global(.access-dialog-title[data-slot='dialog-title']) { font-size: var(--type-lg); font-weight: 650; line-height: 1.3; }
	:global(.access-dialog-header [data-slot='dialog-description']) { overflow-wrap: anywhere; }
	:global(.access-dialog-body) { min-width: 0; }
	:global(.users-header[data-slot='card-header']) { display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem 1rem; padding-bottom: 0; }
	.users-heading { display: flex; min-width: 0; flex: 1 1 auto; align-items: flex-start; gap: 0.65rem; }
	:global(.list-heading-icon) { width: 1rem; height: 1rem; flex: 0 0 auto; margin-top: 0.15rem; color: var(--muted-foreground); }
	.list-heading-copy { display: grid; min-width: 0; gap: 0.1rem; }
	.list-heading-copy :global([data-slot='card-description']) { font-size: var(--type-xs); line-height: 1.45; }
	:global(.users-content[data-slot='card-content']) { gap: 0.75rem; }
	:global(.list-separator[data-slot='separator']) { margin: 0; }
	:global(.load-error) { display: grid; gap: 0.75rem; margin-top: 1rem; }
	.state-panel { display: grid; min-height: 10rem; align-content: center; gap: 0.5rem; padding: 1.25rem 0.25rem; }
	.state-panel strong { font-size: var(--type-base); }
	.state-panel p { max-width: 42rem; margin: 0; color: var(--muted-foreground); font-size: var(--type-sm); line-height: 1.6; }
	.empty-panel { min-height: 12rem; }
	.access-form { display: grid; gap: 1.15rem; }
	.user-summary { display: grid; gap: 0.25rem; color: var(--muted-foreground); font-size: var(--type-sm); line-height: 1.5; }
	.active-control { display: flex; min-height: 3.25rem; align-items: center; gap: 0.75rem; padding: 0.65rem 0.75rem; border: 1px solid var(--border); border-radius: var(--radius); }
	.active-copy { display: grid; gap: 0.2rem; }
	:global(.active-label) { font-size: var(--type-sm); font-weight: 600; }
	.active-copy p { margin: 0; color: var(--muted-foreground); font-size: var(--type-xs); line-height: 1.45; }
	.assignment-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-top: 0.35rem; }
	.assignment-heading h3 { margin: 0; font-size: var(--type-base); font-weight: 620; }
	.assignment-heading p { margin: 0.3rem 0 0; color: var(--muted-foreground); font-size: var(--type-xs); line-height: 1.5; }
	.assignment-row { display: grid; grid-template-columns: minmax(10rem, 1fr) minmax(10rem, 1fr) minmax(11rem, 1.2fr) auto; align-items: end; gap: 0.75rem; padding: 0.9rem; border: 1px solid var(--border); border-radius: var(--radius); }
	.assignment-row.automatic-assignment { grid-template-columns: minmax(12rem, 0.8fr) minmax(15rem, 1.2fr) auto; }
	.target-field { min-width: 0; }
	.scope-note { display: grid; min-width: 0; align-content: center; gap: 0.12rem; padding: 0.1rem 0.25rem; color: var(--muted-foreground); }
	.scope-note > span { font-size: var(--type-xs); line-height: 1.25; }
	.scope-note > strong { color: var(--foreground); font-size: var(--type-sm); font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
	.scope-note > p { margin: 0; font-size: var(--type-xs); line-height: 1.4; }
	.scope-note.scope-unmapped > strong { color: var(--destructive); }
	.form-manager-permission { display: flex; min-width: 0; align-items: flex-start; gap: 0.6rem; margin-top: 0.45rem; padding: 0.65rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); }
	.form-manager-permission > div { display: grid; min-width: 0; gap: 0.15rem; }
	.form-manager-permission p { margin: 0; font-size: var(--type-xs); line-height: 1.4; }
	.assignment-row :global(.remove-assignment) { flex: 0 0 auto; }
	.form-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.55rem; padding-top: 0.25rem; }
	.desktop-users { min-width: 0; margin-top: 0.15rem; }
	:global([data-slot='table']) { width: 100%; border-collapse: collapse; text-align: left; font-size: var(--type-sm); }
	thead { background: var(--muted); color: var(--muted-foreground); font-size: var(--type-xs); }
	thead th { font-weight: 600; }
	th, td { padding: 0.72rem 0.75rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
	tbody tr { transition: background-color 140ms ease; }
	tbody tr:hover { background: var(--muted); }
	tbody tr:last-child > * { border-bottom: 0; }
	tbody th { min-width: 10rem; font-weight: 400; }
	tbody th strong, tbody th small, tbody td small { display: block; }
	tbody th strong { color: var(--foreground); font-weight: 600; }
	tbody th small, tbody td small { margin-top: 0.25rem; color: var(--muted-foreground); font-size: var(--type-xs); line-height: 1.45; }
	tbody td:nth-child(2) { min-width: 12rem; }
	tbody td:nth-child(3) { min-width: 15rem; }
	.assignment-summary { display: grid; gap: 0.35rem; }
	.assignment-summary span { font-size: var(--type-xs); line-height: 1.45; }
	.muted-value { color: var(--muted-foreground); }
	.action-cell { text-align: right; white-space: nowrap; }
	.current-session-note { margin: 0; color: var(--muted-foreground); font-size: var(--type-xs); line-height: 1.5; }
	.mobile-users { display: none; }
	@media (max-width: 58rem) {
		.desktop-users { display: none; }
		.mobile-users { display: grid; gap: 0.7rem; margin-top: 0.15rem; }
		:global(.user-record) { display: grid; min-width: 0; gap: 0; padding: 0; border: 0; background: var(--card); }
		:global(.user-record-content[data-slot='card-content']) { display: grid; gap: 0.75rem; padding: 0.9rem; }
		.user-record-heading { display: flex; min-width: 0; align-items: flex-start; justify-content: space-between; gap: 0.55rem; }
		.user-record-heading > div { min-width: 0; }
		.user-record-heading h3 { margin: 0; font-size: var(--type-base); font-weight: 620; line-height: 1.4; overflow-wrap: anywhere; }
		.user-record-heading p, .user-unit { margin: 0.25rem 0 0; color: var(--muted-foreground); font-size: var(--type-xs); line-height: 1.45; overflow-wrap: anywhere; }
		.user-unit { margin: 0; }
	}
	@media (max-width: 62rem) {
		.assignment-row { grid-template-columns: repeat(2, minmax(0, 1fr)) auto; }
		.assignment-row.automatic-assignment { grid-template-columns: minmax(0, 1fr) auto; }
		.assignment-row.automatic-assignment .scope-note { grid-column: 1 / -1; grid-row: 2; padding: 0.25rem 0; }
		.assignment-row .target-field { grid-column: span 2; }
		.assignment-row :global(.remove-assignment) { grid-column: 3; grid-row: 1; }
		.assignment-row.automatic-assignment :global(.remove-assignment) { grid-column: 2; grid-row: 1; }
	}
	@media (max-width: 42rem) {
		:global(.access-dialog) { width: calc(100vw - 1rem); max-height: calc(100dvh - 1rem); padding: 1rem; }
		:global(.access-dialog-header) { gap: 0.5rem; }
		.users-toolbar { align-items: stretch; flex-direction: column; gap: 0.5rem; }
		.search-field { width: 100%; }
		.result-count { align-self: flex-end; }
		.assignment-heading { align-items: flex-start; flex-direction: column; }
		.assignment-heading > :global(button) { width: 100%; }
		.assignment-row { grid-template-columns: minmax(0, 1fr) auto; gap: 0.8rem; padding: 0.75rem; }
		.assignment-row .field-group { grid-column: 1 / -1; }
		.assignment-row > .field-group:first-child { grid-column: 1; grid-row: 1; }
		.assignment-row :global(.remove-assignment) { grid-column: 2; grid-row: 1; }
		.assignment-row .target-field { grid-column: 1 / -1; }
		.form-actions { flex-direction: column-reverse; }
		.form-actions :global(button) { width: 100%; }
	}
</style>
