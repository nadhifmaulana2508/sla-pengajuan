<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let { ref = $bindable(null), class: className, children, ...restProps }: WithElementRef<HTMLAttributes<HTMLTableCellElement>> = $props();
</script>

<td bind:this={ref} data-slot="table-cell" class={cn('px-3 py-2 align-middle', className)} {...restProps}>
	{@render children?.()}
</td>
