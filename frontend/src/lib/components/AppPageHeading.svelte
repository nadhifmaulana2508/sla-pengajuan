<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Info } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';

	type Props = {
		id?: string;
		eyebrow?: string;
		meta?: string;
		title: string;
		titleCharacterLimit?: number;
		infoContent?: Snippet;
		description?: string;
		descriptionBelow?: boolean;
		descriptionInInfoOnly?: boolean;
		infoDialogWide?: boolean;
		flush?: boolean;
		actionsBelowTitle?: boolean;
		actions?: Snippet;
	};

	let {
		id = 'page-title',
		eyebrow,
		meta,
		title,
		titleCharacterLimit,
		infoContent,
		description,
		descriptionBelow = true,
		descriptionInInfoOnly = false,
		infoDialogWide = false,
		flush = false,
		actionsBelowTitle = false,
		actions
	}: Props = $props();
	let infoOpen = $state(false);
	let visibleTitle = $derived(truncateTitle(title, titleCharacterLimit));
	let titleIsTruncated = $derived(visibleTitle !== title);

	function truncateTitle(value: string, limit = 0): string {
		if (!Number.isFinite(limit) || limit < 2) return value;
		const characters = Array.from(value.trim());
		if (characters.length <= limit) return value;
		const prefix = characters.slice(0, Math.floor(limit) - 1).join('');
		const wordBoundary = prefix.lastIndexOf(' ');
		const shortened = wordBoundary > 0 ? prefix.slice(0, wordBoundary) : prefix;
		return `${shortened.trimEnd()}…`;
	}
</script>

<header class="app-page-heading" class:app-page-heading--flush={flush} class:app-page-heading--description-below={descriptionBelow && Boolean(description) && !descriptionInInfoOnly} class:app-page-heading--actions-below-title={actionsBelowTitle}>
	<div class="app-page-heading-copy">
		{#if eyebrow}<p class="app-page-kicker">{eyebrow}</p>{/if}
		{#if meta}<p class="app-page-meta">{meta}</p>{/if}
		<div class="app-page-title-row" class:app-page-title-row--description-below={descriptionBelow && !descriptionInInfoOnly}>
			<h1 {id} class="app-page-title" class:app-page-title--truncated={titleIsTruncated} title={titleIsTruncated ? title : undefined} aria-label={titleIsTruncated ? title : undefined}>{visibleTitle}</h1>
			{#if description || infoContent}
				<Dialog.Root bind:open={infoOpen}>
					<Dialog.Trigger>
						{#snippet child({ props })}
							<Button {...props} type="button" variant="ghost" class="app-page-info-trigger size-11 min-h-11 min-w-11" aria-label={`Informasi tentang ${title}`} title={`Informasi tentang ${title}`} aria-haspopup="dialog" aria-expanded={infoOpen}>
								<Info class="size-5" aria-hidden="true" />
							</Button>
						{/snippet}
					</Dialog.Trigger>
					<Dialog.Content class={`app-page-info-dialog${infoDialogWide ? ' app-page-info-dialog--wide' : ''}`}>
						<Dialog.Header class="app-page-info-header">
							<Dialog.Title class="app-page-info-title">{title}</Dialog.Title>
							{#if description}<Dialog.Description>{description}</Dialog.Description>{/if}
						</Dialog.Header>
						{#if infoContent}{@render infoContent()}{/if}
					</Dialog.Content>
				</Dialog.Root>
			{/if}
		</div>
		{#if actions && actionsBelowTitle}
			<div class="app-page-heading-action app-page-heading-action--below-title">{@render actions()}</div>
		{/if}
		{#if description && !descriptionInInfoOnly}<p class="app-page-description">{description}</p>{/if}
	</div>
	{#if actions && !actionsBelowTitle}
		<div class="app-page-heading-action">{@render actions()}</div>
	{/if}
</header>

<style>
	:global(.app-page-info-trigger),
	:global(.app-page-info-trigger:hover),
	:global(.app-page-info-trigger:active),
	:global(.app-page-info-trigger[data-state='open']) { display: inline-flex; min-height: 2.75rem; min-width: 2.75rem; align-items: center; justify-content: center; padding: 0; background: transparent !important; color: var(--muted-foreground); box-shadow: none !important; }
	:global(.app-page-info-trigger:hover) { color: var(--foreground); }
	:global(.app-page-info-dialog[data-slot='dialog-content']) { width: min(28rem, calc(var(--app-visual-viewport-width, 100vw) - 1.5rem)); max-height: min(calc(var(--app-visual-viewport-height, 100dvh) - 1.5rem), 32rem); overflow-y: auto; }
	:global(.app-page-info-dialog--wide[data-slot='dialog-content']) { width: min(48rem, calc(var(--app-visual-viewport-width, 100vw) - 2rem)); max-width: min(48rem, calc(var(--app-visual-viewport-width, 100vw) - 2rem)); max-height: min(calc(var(--app-visual-viewport-height, 100dvh) - 1.5rem), 48rem); }
	:global(.app-page-info-header[data-slot='dialog-header']) { padding-right: 2rem; }
	:global(.app-page-info-title[data-slot='dialog-title']) { font-size: var(--type-lg); font-weight: 650; line-height: 1.3; }
	:global(.app-page-info-header [data-slot='dialog-description']) { line-height: 1.6; }
	:global(.app-page-heading-action--below-title) { width: 100%; justify-content: flex-start; padding-top: 0; }
	:global(.app-page-heading--actions-below-title .app-page-title-row) { align-items: flex-start; }
	:global(.app-page-heading--actions-below-title .app-page-title) { min-width: 0; max-width: 72rem; overflow-wrap: anywhere; }
	:global(.app-page-heading--actions-below-title .app-page-title:not(.app-page-title--truncated)) { font-size: clamp(1.35rem, 2vw, 1.75rem); line-height: 1.2; letter-spacing: -0.035em; }
	:global(.app-page-heading--actions-below-title .app-page-title--truncated) { font-size: 14px; line-height: 1.4; letter-spacing: 0; }
	:global(.app-page-title--truncated + button.app-page-info-trigger) { width: 2rem; min-width: 2rem; height: 2rem; min-height: 2rem; }
	:global(.app-page-title--truncated + button.app-page-info-trigger svg) { width: 1rem; height: 1rem; }
	@media (max-width: 42rem) {
		:global(.app-page-heading--actions-below-title .app-page-title:not(.app-page-title--truncated)) { font-size: var(--type-page-title); }
	}
</style>
