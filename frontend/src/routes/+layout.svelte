<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { initializeTheme } from '#lib/features/theme/theme.store.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(() => {
		initializeTheme();

		const root = document.documentElement;
		const visualViewport = window.visualViewport;
		const updateVisualViewport = () => {
			const width = visualViewport?.width ?? window.innerWidth;
			const height = visualViewport?.height ?? window.innerHeight;
			const left = visualViewport?.offsetLeft ?? 0;
			const top = visualViewport?.offsetTop ?? 0;

			root.style.setProperty('--app-visual-viewport-width', `${width}px`);
			root.style.setProperty('--app-visual-viewport-height', `${height}px`);
			root.style.setProperty('--app-visual-viewport-left', `${left}px`);
			root.style.setProperty('--app-visual-viewport-top', `${top}px`);
			root.style.setProperty('--app-visual-viewport-center-x', `${left + width / 2}px`);
			root.style.setProperty('--app-visual-viewport-center-y', `${top + height / 2}px`);
		};

		updateVisualViewport();
		visualViewport?.addEventListener('resize', updateVisualViewport);
		visualViewport?.addEventListener('scroll', updateVisualViewport);
		window.addEventListener('resize', updateVisualViewport);

		return () => {
			visualViewport?.removeEventListener('resize', updateVisualViewport);
			visualViewport?.removeEventListener('scroll', updateVisualViewport);
			window.removeEventListener('resize', updateVisualViewport);
			for (const property of [
				'--app-visual-viewport-width',
				'--app-visual-viewport-height',
				'--app-visual-viewport-left',
				'--app-visual-viewport-top',
				'--app-visual-viewport-center-x',
				'--app-visual-viewport-center-y'
			]) root.style.removeProperty(property);
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<a class="skip-link" href="#main-content">Lewati ke konten utama</a>
{@render children()}
