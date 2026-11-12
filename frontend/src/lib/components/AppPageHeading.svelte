<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		id?: string;
		eyebrow?: string;
		meta?: string;
		title: string;
		description?: string;
		descriptionBelow?: boolean;
		flush?: boolean;
		actions?: Snippet;
	};

	let {
		id = 'page-title',
		eyebrow,
		meta,
		title,
		description,
		descriptionBelow = true,
		flush = false,
		actions
	}: Props = $props();
</script>

<header class="app-page-heading" class:app-page-heading--flush={flush} class:app-page-heading--description-below={descriptionBelow && Boolean(description)}>
	<div class="app-page-heading-copy">
		{#if eyebrow}<p class="app-page-kicker">{eyebrow}</p>{/if}
		{#if meta}<p class="app-page-meta">{meta}</p>{/if}
		<div class="app-page-title-row" class:app-page-title-row--description-below={descriptionBelow}>
			<h1 {id} class="app-page-title">{title}</h1>
			{#if description}<p class="app-page-description">{description}</p>{/if}
		</div>
	</div>
	{#if actions}
		<div class="app-page-heading-action">{@render actions()}</div>
	{/if}
</header>
