<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		tableClass,
		label,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { tableClass?: string; label: string } = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	bind:this={ref}
	data-slot="table-container"
	class={cn('relative w-full overflow-x-auto', className)}
	role="region"
	tabindex="0"
	aria-label={label}
	{...restProps}
>
	<table data-slot="table" class={cn('w-full caption-bottom text-sm', tableClass)}>
		{@render children?.()}
	</table>
</div>
