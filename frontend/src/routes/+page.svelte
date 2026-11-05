<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ApiError } from '#lib/api/client.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Eye, EyeOff, Moon, Sun } from '@lucide/svelte';
	import { loginWithSso } from '#lib/features/auth/auth.api.js';
	import {
		authSession,
		getRememberedEmployeeId,
		rememberEmployeeId,
		setAuthenticatedSession
	} from '#lib/features/auth/auth.store.js';
	import { theme, toggleTheme } from '#lib/features/theme/theme.store.js';

	let employeeId = $state('');
	let password = $state('');
	let isPasswordVisible = $state(false);
	let isSubmitting = $state(false);
	let errorMessage = $state('');

	onMount(() => {
		employeeId = getRememberedEmployeeId();
		const unsubscribe = authSession.subscribe((session) => {
			if (session.token) void goto('/dashboard');
		});
		return unsubscribe;
	});

	function updateEmployeeId(event: Event): void {
		if (!(event.currentTarget instanceof HTMLInputElement)) return;

		employeeId = event.currentTarget.value;
		rememberEmployeeId(employeeId);
	}

	async function submitLogin(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSubmitting) return;

		isSubmitting = true;
		errorMessage = '';
		rememberEmployeeId(employeeId);
		try {
			const session = await loginWithSso(employeeId.trim(), password);
			setAuthenticatedSession(session.token, session.profile);
			password = '';
			await goto('/dashboard');
		} catch (error) {
			errorMessage = error instanceof ApiError
				? error.message
				: 'Login belum berhasil. Periksa koneksi, lalu coba lagi.';
		} finally {
			isSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>Masuk | Sistem SLA Pengajuan</title>
	<meta
		name="description"
		content="Masuk ke Sistem SLA Pengajuan menggunakan akun SSO perusahaan."
	/>
</svelte:head>

<main class="sign-in-page">
	<section class="process-panel" aria-labelledby="product-name">
		<a class="wordmark" href="/" aria-label="Sistem SLA Pengajuan">
			<span class="wordmark-mark" aria-hidden="true">S</span>
			<span id="product-name">Sistem SLA <span class="wordmark-light">Pengajuan</span></span>
		</a>

		<div class="process-intro">
			<p class="section-label">Alur penanganan</p>
			<h1>Jelas siapa yang menangani. Terukur berapa lama prosesnya.</h1>
			<p class="process-description">
				Pengajuan bergerak melalui unit yang bertanggung jawab, dengan waktu penanganan tercatat di setiap tahap.
			</p>
		</div>

		<ol class="workflow" aria-label="Urutan unit penanganan pengajuan">
			<li>
				<span class="workflow-index">01</span>
				<span class="workflow-copy"><strong>Cabang</strong><small>Mengirim pengajuan</small></span>
			</li>
			<li>
				<span class="workflow-index">02</span>
				<span class="workflow-copy"><strong>Korwil</strong><small>Memeriksa dan meneruskan</small></span>
			</li>
			<li>
				<span class="workflow-index">03</span>
				<span class="workflow-copy"><strong>Divisi Pusat</strong><small>Menindaklanjuti pengajuan</small></span>
			</li>
		</ol>

		<p class="panel-footnote">Satu riwayat proses untuk Cabang, Korwil, dan Kantor Pusat.</p>
	</section>

	<section class="form-panel" aria-labelledby="login-title">
		<div class="login-theme-toggle">
			<Button
				variant="ghost"
				size="icon-lg"
				class="min-h-11 min-w-11 border-0 bg-transparent p-0 shadow-none hover:bg-transparent hover:text-primary dark:hover:bg-transparent"
				type="button"
				aria-label={$theme === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap'}
				title={$theme === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap'}
				aria-pressed={$theme === 'dark'}
				onclick={toggleTheme}
			>
				{#if $theme === 'dark'}<Sun class="size-4" aria-hidden="true" />{:else}<Moon class="size-4" aria-hidden="true" />{/if}
			</Button>
		</div>
		<div class="login-form-wrap">
			<div class="login-heading">
				<p class="section-label">Akses pegawai</p>
				<h2 id="login-title">Masuk ke Sistem SLA</h2>
				<p>Gunakan ID pegawai dan password akun SSO perusahaan.</p>
			</div>

			<form class="login-form" onsubmit={submitLogin}>
				<div class="field-group">
					<Label for="employee-id">ID pegawai</Label>
					<Input
						id="employee-id"
						name="id_peg"
						autocomplete="username"
						class="min-h-11 border-input text-sm focus-visible:ring-primary"
						placeholder="Masukkan ID pegawai"
						value={employeeId}
						oninput={updateEmployeeId}
						required
						disabled={isSubmitting}
					/>
				</div>

				<div class="field-group">
					<Label for="password">Password</Label>
					<div class="password-field">
						<Input
							id="password"
							name="password"
							type={isPasswordVisible ? 'text' : 'password'}
							autocomplete="current-password"
							class="min-h-11 border-input pr-12 text-sm focus-visible:ring-primary"
							placeholder="Masukkan password SSO"
							bind:value={password}
							required
							disabled={isSubmitting}
						/>
						<Button
							variant="ghost"
							size="icon-lg"
							class="absolute right-1 top-1/2 min-h-11 min-w-11 -translate-y-1/2 border-0 bg-transparent p-0 shadow-none hover:bg-transparent hover:text-primary focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-transparent"
							type="button"
							aria-label={isPasswordVisible ? 'Sembunyikan password' : 'Tampilkan password'}
							title={isPasswordVisible ? 'Sembunyikan password' : 'Tampilkan password'}
							aria-pressed={isPasswordVisible}
							disabled={isSubmitting}
							onclick={() => (isPasswordVisible = !isPasswordVisible)}
						>
							{#if isPasswordVisible}<EyeOff class="size-4" aria-hidden="true" />{:else}<Eye class="size-4" aria-hidden="true" />{/if}
						</Button>
					</div>
				</div>

				{#if errorMessage}
					<Alert.Root variant="destructive">
						<Alert.Title>Login belum berhasil</Alert.Title>
						<Alert.Description>{errorMessage}</Alert.Description>
					</Alert.Root>
				{/if}

				<Button class="submit-button min-h-11 w-full" size="lg" type="submit" disabled={isSubmitting}>
					{isSubmitting ? 'Memeriksa akun...' : 'Masuk'}
				</Button>
			</form>

			<p class="form-note">
				Password hanya dikirim ke backend untuk diteruskan ke SSO. Sistem SLA tidak menyimpannya.
			</p>
		</div>
	</section>
</main>

<style>
	.sign-in-page {
		min-height: 100svh;
		display: grid;
		grid-template-columns: minmax(0, 1.03fr) minmax(420px, 0.97fr);
		background: var(--background);
		color: var(--foreground);
	}

	.process-panel {
		min-height: 100svh;
		display: flex;
		flex-direction: column;
		padding: clamp(1.25rem, 3.5vw, 3.5rem);
		color: #f8fafc;
		background: #111827;
	}

	.wordmark {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		width: fit-content;
		color: #f8fafc;
		font-size: var(--type-sm);
		font-weight: 650;
		text-decoration: none;
		letter-spacing: -0.02em;
	}

	.wordmark-mark {
		display: grid;
		width: 2rem;
		height: 2rem;
		place-items: center;
		border: 1px solid #526174;
		border-radius: 0.55rem;
		color: #fff;
		font-size: var(--type-sm);
	}

	.wordmark-light {
		color: #aab5c4;
		font-weight: 450;
	}

	.process-intro {
		max-width: 36rem;
		margin: auto 0 1.5rem;
	}

	.section-label {
		margin: 0 0 1rem;
		color: var(--primary);
		font-size: var(--type-xs);
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.process-panel .section-label {
		color: #afc4ff;
		margin-bottom: 0.75rem;
	}

	h1 {
		max-width: 34rem;
		margin: 0;
		font-size: clamp(2rem, 3.8vw, 3.35rem);
		font-weight: 560;
		line-height: 1.1;
		letter-spacing: -0.055em;
	}

	.process-description {
		max-width: 31rem;
		margin: 0.9rem 0 0;
		color: #b8c3d1;
		font-size: var(--type-base);
		line-height: 1.55;
	}

	.workflow {
		position: relative;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.workflow::before {
		position: absolute;
		top: 1rem;
		right: 14%;
		left: 10%;
		height: 1px;
		background: #445164;
		content: '';
	}

	.workflow li {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.6rem;
	}

	.workflow-index {
		z-index: 1;
		display: grid;
		width: 2rem;
		height: 2rem;
		place-items: center;
		border: 1px solid #617087;
		border-radius: 50%;
		background: #111827;
		color: #dce4ed;
		font-size: var(--type-xs);
		font-variant-numeric: tabular-nums;
	}

	.workflow li:first-child .workflow-index {
		border-color: #afc4ff;
		background: #2747a0;
		color: white;
	}

	.workflow-copy {
		display: grid;
		gap: 0.35rem;
	}

	.workflow-copy strong {
		font-size: var(--type-sm);
		font-weight: 600;
	}

	.workflow-copy small {
		max-width: 9rem;
		color: #aab5c4;
		font-size: var(--type-xs);
		line-height: 1.45;
	}

	.panel-footnote {
		margin: 1.6rem 0 0;
		color: #8996a8;
		font-size: var(--type-xs);
	}

	.form-panel {
		position: relative;
		display: grid;
		place-items: center;
		padding: 1.5rem clamp(1.5rem, 5vw, 5rem);
		background: var(--background);
	}

	.login-theme-toggle {
		position: absolute;
		top: 1rem;
		right: 1rem;
		z-index: 1;
	}

	.login-form-wrap {
		width: min(100%, 25rem);
	}

	.login-heading {
		margin-bottom: 1.4rem;
	}

	.login-heading .section-label {
		margin-bottom: 0.65rem;
		color: var(--primary);
	}

	h2 {
		margin: 0;
		color: var(--foreground);
		font-size: var(--type-2xl);
		font-weight: 620;
		letter-spacing: -0.04em;
	}

	.login-heading > p:last-child {
		margin: 0.75rem 0 0;
		color: var(--muted-foreground);
		font-size: var(--type-base);
		line-height: 1.6;
	}

	.login-form {
		display: grid;
		gap: 1rem;
	}

	.field-group {
		display: grid;
		gap: 0.5rem;
	}

	.password-field {
		position: relative;
	}

	.form-note {
		margin: 1rem 0 0;
		color: var(--muted-foreground);
		font-size: var(--type-xs);
		line-height: 1.65;
	}

	@media (min-width: 801px) and (max-height: 720px) {
		.process-panel { padding-block: 1.1rem; }
		.process-intro { margin-bottom: 1rem; }
		h1 { font-size: clamp(1.8rem, 3.3vw, 2.65rem); line-height: 1.06; }
		.process-description { margin-top: 0.7rem; font-size: var(--type-sm); line-height: 1.45; }
		.workflow li { gap: 0.45rem; }
		.panel-footnote { margin-top: 1rem; }
		.form-panel { padding-block: 1rem; }
		.login-heading { margin-bottom: 1rem; }
		h2 { font-size: var(--type-2xl); }
		.login-form { gap: 0.8rem; }
		.form-note { margin-top: 0.75rem; }
	}

	@media (max-width: 900px) {
		.sign-in-page {
			grid-template-columns: minmax(0, 1fr);
			grid-auto-rows: max-content;
			align-content: start;
		}

		.form-panel {
			order: 2;
			min-height: auto;
			padding: 1.75rem 1.5rem 2.5rem;
		}

		.process-panel {
			order: 1;
			min-height: auto;
			padding: 0.9rem 1.25rem;
		}

		.process-intro, .workflow, .panel-footnote { display: none; }
		.form-panel { align-content: start; }
		.login-form-wrap { margin-block: auto; }
	}

	@media (max-width: 460px) {
		.form-panel { padding: 1.5rem 1rem 2rem; }
		.login-theme-toggle { top: 0.65rem; right: 0.75rem; }
		.login-heading { padding-top: 2.5rem; }
	}

	@media (min-width: 901px) {
		.sign-in-page {
			min-height: 100dvh;
			height: 100dvh;
			grid-template-rows: minmax(0, 1fr);
			overflow: hidden;
		}

		.process-panel,
		.form-panel {
			min-height: 0;
			overflow-y: auto;
			overscroll-behavior: contain;
		}
	}
</style>
