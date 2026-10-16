<script lang="ts">
	import Icon from '#lib/client/Icon.svelte';
	import { overtone } from '#lib/client/overtone.svelte.ts';

	const DAUERN = [15, 30, 60, 90];
	const LAUT = [
		{ wert: 0, name: 'wie jetzt' },
		{ wert: 12, name: 'leise' },
		{ wert: 20, name: 'normal' },
		{ wert: 35, name: 'deutlich' }
	];

	let text = $state('');
	let stimme = $state('Anna');
	let klangart = $state('regen');
	let dauer = $state(30);
	let lautAnsage = $state(0);
	let lautKlang = $state(0);

	$effect(() => {
		overtone.ladeTon();
	});

	const gewaehlt = $derived(overtone.ton.klaenge.find((k) => k.name === klangart));
	const berechnet = $derived(overtone.ton.vorhanden.some((v) => v.name === klangart));
	const stimmenName = $derived(overtone.ton.stimmen.find((s) => s.name === stimme)?.name ?? 'Anna');
	const geraetWeg = $derived(!overtone.verbunden);

	async function vorlesen() {
		if (!text.trim()) {
			overtone.melde('Bitte erst einen Text eingeben.');
			return;
		}
		await overtone.tonAktion({ action: 'ansage', text, stimme, lautstaerke: lautAnsage });
	}

	async function klangStarten() {
		await overtone.tonAktion({ action: 'klang', name: klangart, minuten: dauer, lautstaerke: lautKlang });
	}
</script>

<div class="space-y-3">
	<section class="card bg-base-200">
		<div class="card-body gap-3 p-4">
			<h2 class="card-title text-base">
				<Icon name="ton" groesse={18} />
				Ansage sprechen
			</h2>
			<p class="text-sm gedaempft">
				Der Text wird auf diesem Rechner gesprochen und über den Lautsprecher abgespielt. Kein Konto, keine
				Wolke.
			</p>

			<label class="text-sm font-medium" for="ansage-text">Text</label>
			<textarea
				id="ansage-text"
				class="textarea textarea-bordered h-24 w-full text-base"
				placeholder="Zum Beispiel: Essen ist fertig, kommt an den Tisch."
				bind:value={text}
				maxlength="600"
			></textarea>

			<div class="flex items-baseline justify-between">
				<span class="text-sm font-medium">Stimme</span>
				<span class="text-xs gedaempft">{stimmenName}</span>
			</div>
			<select class="select select-bordered h-12 w-full" bind:value={stimme}>
				{#each overtone.ton.stimmen as s (s.name)}
					<option value={s.name}>{s.name}, {s.text}</option>
				{/each}
			</select>

			<div class="flex items-baseline justify-between">
				<span class="text-sm font-medium">Lautstärke</span>
				<span class="text-xs gedaempft"
					>{lautAnsage === 0 ? 'bleibt, wie sie ist' : `auf ${lautAnsage} gesetzt`}</span
				>
			</div>
			<div class="grid grid-cols-4 gap-2">
				{#each LAUT as l (l.wert)}
					<button
						class="btn h-11 px-1 text-xs {lautAnsage === l.wert ? 'btn-primary' : ''}"
						aria-pressed={lautAnsage === l.wert}
						onclick={() => (lautAnsage = l.wert)}>{l.name}</button
					>
				{/each}
			</div>

			<button class="btn btn-primary h-12 w-full text-base" disabled={overtone.tonLaeuft} onclick={vorlesen}>
				<Icon name={overtone.tonLaeuft ? 'timer' : 'play'} groesse={18} />
				{overtone.tonLaeuft ? 'wird gesprochen' : 'Vorlesen'}
			</button>
			{#if geraetWeg}
				<p class="text-xs gedaempft">
					Der Lautsprecher ist gerade nicht erreichbar. Die Ansage wird trotzdem gespeichert und ist später
					abspielbar.
				</p>
			{/if}
		</div>
	</section>

	<section class="card bg-base-200">
		<div class="card-body gap-3 p-4">
			<h2 class="card-title text-base">
				<Icon name="weiter" groesse={18} />
				Zuletzt gesprochen
			</h2>
			{#if overtone.ton.ansagen.length === 0}
				<p class="text-sm gedaempft">Noch nichts gespeichert. Gesprochenes landet hier und lässt sich wiederholen.</p>
			{:else}
				<div class="flex flex-col gap-2">
					{#each overtone.ton.ansagen as a (a.datei)}
						<div class="flex items-start gap-2">
							<span class="flex-1 text-sm">
								<span class="block">{a.text}</span>
								<span class="block text-xs gedaempft">{a.stimme}</span>
							</span>
							<button
								class="btn h-11 px-3"
								disabled={overtone.tonLaeuft}
								onclick={() => overtone.tonAktion({ action: 'nochmal', datei: a.datei })}
								aria-label={`Ansage nochmal spielen: ${a.text.slice(0, 40)}`}>
								<Icon name="play" groesse={18} />
							</button>
							<button
								class="btn btn-ghost h-11 px-3"
								disabled={overtone.tonLaeuft}
								onclick={() => overtone.tonAktion({ action: 'loeschen', datei: a.datei })}
								aria-label={`Ansage löschen: ${a.text.slice(0, 40)}`}>
								<Icon name="loeschen" groesse={18} />
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</section>

	<section class="card bg-base-200">
		<div class="card-body gap-3 p-4">
			<h2 class="card-title text-base">
				<Icon name="welle" groesse={18} />
				Klang zum Einschlafen
			</h2>
			<p class="text-sm gedaempft">
				Der Klang wird auf diesem Rechner berechnet und läuft in Schleife, bis die Laufzeit abgelaufen ist.
				Dann hört er von selbst auf.
			</p>

			<div class="grid grid-cols-2 gap-2">
				{#each overtone.ton.klaenge as k (k.name)}
					<button
						class="btn h-16 flex-col items-start gap-0 px-3 text-left {klangart === k.name ? 'btn-primary' : ''}"
						aria-pressed={klangart === k.name}
						onclick={() => (klangart = k.name)}>
						<span class="block">{k.titel}</span>
						<span class="block text-xs opacity-70">{k.text}</span>
					</button>
				{/each}
			</div>

			<div class="flex items-baseline justify-between">
				<span class="text-sm font-medium">Laufzeit</span>
				<span class="text-xs gedaempft"
					>{berechnet ? 'Klang ist berechnet' : 'wird beim ersten Start berechnet'} und läuft dann
					{dauer} Minuten</span
				>
			</div>
			<div class="grid grid-cols-4 gap-2">
				{#each DAUERN as d (d)}
					<button
						class="btn h-11 px-1 text-sm {dauer === d ? 'btn-primary' : ''}"
						aria-pressed={dauer === d}
						onclick={() => (dauer = d)}>{d} Min</button
					>
				{/each}
			</div>

			<div class="flex items-baseline justify-between">
				<span class="text-sm font-medium">Lautstärke</span>
				<span class="text-xs gedaempft"
					>{lautKlang === 0 ? 'bleibt, wie sie ist' : `auf ${lautKlang} gesetzt`}</span
				>
			</div>
			<div class="grid grid-cols-4 gap-2">
				{#each LAUT as l (l.wert)}
					<button
						class="btn h-11 px-1 text-xs {lautKlang === l.wert ? 'btn-primary' : ''}"
						aria-pressed={lautKlang === l.wert}
						onclick={() => (lautKlang = l.wert)}>{l.name}</button
					>
				{/each}
			</div>

			<button class="btn btn-primary h-12 w-full text-base" disabled={overtone.tonLaeuft} onclick={klangStarten}>
				<Icon name={overtone.tonLaeuft ? 'timer' : 'play'} groesse={18} />
				{overtone.tonLaeuft ? 'wird berechnet' : `${gewaehlt?.titel ?? 'Klang'} starten`}
			</button>
			<button
				class="btn btn-outline h-12 w-full"
				disabled={overtone.tonLaeuft}
				onclick={() => overtone.tonAktion({ action: 'stop' })}>
				<Icon name="stop" groesse={18} />
				Stopp
			</button>
		</div>
	</section>
</div>
