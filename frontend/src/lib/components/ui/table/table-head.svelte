<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let { ref = $bindable(null), class: className, children, ...restProps }: WithElementRef<HTMLAttributes<HTMLTableCellElement>> & { scope?: 'col' | 'row' } = $props();
</script>

<th bind:this={ref} data-slot="table-head" class={cn('h-10 px-3 text-left align-middle text-xs font-medium text-muted-foreground', className)} {...restProps}>
	{@render children?.()}
</th>
