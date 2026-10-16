<script lang="ts">
	import Icon from '#lib/client/Icon.svelte';
	import { overtone, WIEDERGABEARTEN } from '#lib/client/overtone.svelte.ts';

	let bass = $state<number | null>(null);
	let hoehen = $state<number | null>(null);
	let bassZieht = $state(false);
	let hoehenZieht = $state(false);

	const klang = $derived(overtone.zustand.klang);
	const unbekannt = $derived(!klang || typeof klang.bass !== 'number');

	$effect(() => {
		if (typeof klang?.bass === 'number' && !bassZieht) bass = klang.bass;
	});
	$effect(() => {
		if (typeof klang?.treble === 'number' && !hoehenZieht) hoehen = klang.treble;
	});

	function reglerText(wert: number | null) {
		if (wert === null) return 'unbekannt';
		if (wert === 0) return 'neutral';
		return `${wert > 0 ? '+' : ''}${wert}`;
	}
</script>

<div class="space-y-3">
	<section class="card bg-base-200">
		<div class="card-body gap-3 p-4">
			<h2 class="card-title text-base">
				<Icon name="welle" groesse={18} />
				Klang
			</h2>
			{#if unbekannt}
				<p class="text-sm gedaempft">
					Der Lautsprecher antwortet gerade nicht, deshalb ruhen die Regler. Sobald er wieder im Netz ist,
					zeigen sie seine Werte.
				</p>
			{/if}

			<div class="flex items-baseline justify-between">
				<label class="text-sm font-medium" for="bass">Bass</label>
				<span class="text-lg font-semibold tabular-nums">{reglerText(bass)}</span>
			</div>
			<div class="flex items-center gap-3">
				<span class="text-xs gedaempft">-10</span>
				<input
					id="bass"
					class="range range-primary h-11 flex-1 {unbekannt ? 'opacity-40' : ''}"
					type="range"
					min="-10"
					max="10"
					step="1"
					disabled={unbekannt}
					value={bass ?? 0}
					onpointerdown={() => (bassZieht = true)}
					oninput={(e) => (bass = Number((e.currentTarget as HTMLInputElement).value))}
					onchange={(e) => {
						bassZieht = false;
						overtone.befehl('bass', Number((e.currentTarget as HTMLInputElement).value));
					}}
				/>
				<span class="text-xs gedaempft">+10</span>
			</div>

			<div class="flex items-baseline justify-between">
				<label class="text-sm font-medium" for="hoehen">Höhen</label>
				<span class="text-lg font-semibold tabular-nums">{reglerText(hoehen)}</span>
			</div>
			<div class="flex items-center gap-3">
				<span class="text-xs gedaempft">-10</span>
				<input
					id="hoehen"
					class="range range-primary h-11 flex-1 {unbekannt ? 'opacity-40' : ''}"
					type="range"
					min="-10"
					max="10"
					step="1"
					disabled={unbekannt}
					value={hoehen ?? 0}
					onpointerdown={() => (hoehenZieht = true)}
					oninput={(e) => (hoehen = Number((e.currentTarget as HTMLInputElement).value))}
					onchange={(e) => {
						hoehenZieht = false;
						overtone.befehl('treble', Number((e.currentTarget as HTMLInputElement).value));
					}}
				/>
				<span class="text-xs gedaempft">+10</span>
			</div>

			<label class="flex cursor-pointer items-center justify-between gap-3 py-2">
				<span>
					<span class="block text-sm font-medium">Loudness</span>
					<span class="block text-xs gedaempft">Bass und Höhen werden bei leiser Wiedergabe angehoben</span>
				</span>
				<input
					class="toggle toggle-primary h-11 w-14"
					type="checkbox"
					disabled={typeof klang?.loudness !== 'number'}
					checked={klang?.loudness === 1}
					onchange={() => overtone.befehl('loudness', klang?.loudness === 1 ? 0 : 1)}
				/>
			</label>
		</div>
	</section>

	<section class="card bg-base-200">
		<div class="card-body gap-3 p-4">
			<h2 class="card-title text-base">
				<Icon name="sender" groesse={18} />
				Wiedergabe
			</h2>
			<p class="text-sm gedaempft">Gilt für Listen und Alben, nicht für Radiosender.</p>
			<div class="flex flex-col gap-2">
				{#each WIEDERGABEARTEN as w (w.wert)}
					<button
						class="btn h-12 justify-start gap-3 {overtone.zustand.playMode === w.wert ? 'btn-primary' : ''}"
						aria-pressed={overtone.zustand.playMode === w.wert}
						onclick={() => overtone.befehl('playmode', w.wert)}>
						<Icon name={overtone.zustand.playMode === w.wert ? 'check' : 'ring'} groesse={18} />
						<span class="flex-1 text-left">
							<span class="block">{w.name}</span>
							<span class="block text-xs opacity-70">{w.text}</span>
						</span>
					</button>
				{/each}
			</div>
			<label class="flex cursor-pointer items-center justify-between gap-3 py-2">
				<span>
					<span class="block text-sm font-medium">Überblenden</span>
					<span class="block text-xs gedaempft">weicher Übergang zwischen Titeln</span>
				</span>
				<input
					class="toggle toggle-primary h-11 w-14"
					type="checkbox"
					disabled={overtone.zustand.crossfade === null}
					checked={overtone.zustand.crossfade === 1}
					onchange={() => overtone.befehl('crossfade', overtone.zustand.crossfade === 1 ? 0 : 1)}
				/>
			</label>
		</div>
	</section>

	<section class="card bg-base-200">
		<div class="card-body gap-3 p-4">
			<h2 class="card-title text-base">
				<Icon name="geraet" groesse={18} />
				Gerät
			</h2>
			<label class="flex cursor-pointer items-center justify-between gap-3 py-2">
				<span>
					<span class="block text-sm font-medium">Lampenanzeige</span>
					<span class="block text-xs gedaempft">
						{overtone.zustand.led === 'On' ? 'an' : overtone.zustand.led === 'Off' ? 'aus' : 'noch unbekannt'}
					</span>
				</span>
				<input
					class="toggle toggle-primary h-11 w-14"
					type="checkbox"
					disabled={overtone.zustand.led === ''}
					checked={overtone.zustand.led === 'On'}
					onchange={() => overtone.befehl('led', overtone.zustand.led === 'On' ? 0 : 1)}
				/>
			</label>
		</div>
	</section>
</div>
