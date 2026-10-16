<script lang="ts">
	import { overtone } from '#lib/client/overtone.svelte.ts';
	import Icon from '#lib/client/Icon.svelte';
</script>

<div
	class="toast toast-top toast-center z-[60] w-full max-w-[min(96vw,32rem)] gap-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] px-2">
	{#each overtone.meldungen as m (m.id)}
		<div
			class="alert {m.art === 'fehler' ? 'alert-error' : 'alert-success'} items-start shadow-lg"
			role={m.art === 'fehler' ? 'alert' : 'status'}>
			<Icon name={m.art === 'fehler' ? 'info' : 'check'} groesse={18} klasse="mt-0.5 shrink-0" />
			<div class="min-w-0 flex-1">
				<p class="text-sm leading-snug">{m.text}</p>
				{#if m.detail}
					<details class="mt-2 text-xs opacity-90">
						<summary class="cursor-pointer">technisches Detail</summary>
						<code class="mt-1 block break-all rounded-lg bg-black/30 p-2">{m.detail}</code>
					</details>
				{/if}
				<div class="mt-2 flex flex-wrap gap-2">
					{#if m.wiederholen}
						<button
							class="btn btn-xs btn-outline"
							onclick={() => {
								const w = m.wiederholen;
								overtone.schliesse(m.id);
								w?.();
							}}>erneut versuchen</button>
					{/if}
					<button class="btn btn-xs btn-ghost" onclick={() => overtone.schliesse(m.id)}>
						<Icon name="schliessen" groesse={14} />
						schließen
					</button>
				</div>
			</div>
		</div>
	{/each}
</div>
