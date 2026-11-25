<script lang="ts">
	import AppNavbar from '#lib/components/AppNavbar.svelte';
	import type { LayoutProps } from '../$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<title>Pengajuan | Sistem SLA</title>
	<meta name="description" content="Buat dan lacak pengajuan Cabang serta antrean Korwil." />
</svelte:head>

<div class="workflow-shell">
	<AppNavbar />
	<main id="main-content" class="workflow-content app-page-shell">{@render children()}</main>
</div>

<style>
	.workflow-shell { min-height: 100svh; background: var(--muted); color: var(--foreground); }
	@media (max-width: 72rem) {
		.workflow-content.app-page-shell {
			box-sizing: border-box;
			width: 100%;
			max-width: none;
			margin-inline: 0;
			padding-inline: max(var(--page-gutter), env(safe-area-inset-left)) max(var(--page-gutter), env(safe-area-inset-right));
		}
	}
</style>
