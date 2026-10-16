<script lang="ts">
	import Icon from '#lib/client/Icon.svelte';
	import { overtone } from '#lib/client/overtone.svelte.ts';

	const laufend = $derived(overtone.laufenderSender);
	const laeuft = $derived(overtone.laeuft);
</script>

<div class="space-y-3">
	{#if overtone.zuletzt}
		<button
			class="btn btn-block h-16 justify-between border-base-300 bg-base-200"
			onclick={() => overtone.sende(overtone.zuletzt!.id)}>
			<span class="flex min-w-0 items-center gap-3">
				<Icon name="erneut" groesse={19} />
				<span class="flex min-w-0 flex-col items-start">
					<span class="text-xs gedaempft">zuletzt gespielt</span>
					<span class="truncate">{overtone.zuletzt.name}</span>
				</span>
			</span>
			{#if overtone.startend === overtone.zuletzt.id}
				<span class="loading loading-spinner loading-sm"></span>
			{/if}
		</button>
	{/if}

	{#if overtone.stations.length}
		{#if laufend && laeuft}
			<div class="alert alert-success alert-soft px-3 py-2 text-sm" role="status">
				<Icon name="welle" groesse={16} />
				<span>{laufend.name} läuft{overtone.zustand.relTime ? ` · ${overtone.zustand.relTime}` : ''}</span>
			</div>
		{/if}
		<ul class="space-y-2">
			{#each overtone.stations as st (st.id)}
				<li>
					<button
						class="btn h-16 w-full justify-between border-base-300 bg-base-200 {laufend?.id === st.id
							? 'border-secondary ring-1 ring-secondary'
							: ''}"
						aria-current={laufend?.id === st.id ? 'true' : undefined}
						onclick={() => overtone.sende(st.id)}>
						<span class="flex min-w-0 items-center gap-3">
							<Icon name="sender" groesse={20} />
							<span class="truncate">{st.name}</span>
						</span>
						{#if overtone.startend === st.id}
							<span class="loading loading-spinner loading-sm"></span>
							<span class="sr-only">wird gestartet</span>
						{:else if laufend?.id === st.id && laeuft}
							<span class="badge badge-success badge-sm">läuft</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="space-y-2">
			<div class="skeleton h-16 w-full"></div>
			<div class="skeleton h-16 w-full"></div>
			<div class="skeleton h-16 w-full"></div>
		</div>
	{/if}

	<p class="px-1 pt-2 text-xs gedaempft">
		Sieben feste Sender. Der laufende Sender ist markiert.
	</p>
</div>
