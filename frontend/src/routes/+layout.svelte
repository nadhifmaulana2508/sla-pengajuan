<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { initializeTheme } from '#lib/features/theme/theme.store.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(initializeTheme);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
