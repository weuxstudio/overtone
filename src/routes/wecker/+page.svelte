<script lang="ts">
	import Icon from '#lib/client/Icon.svelte';
	import {
		overtone,
		STUNDEN,
		MINUTEN,
		WIEDERHOLUNGSTEXT,
		type Weckzeit
	} from '#lib/client/overtone.svelte.ts';

	let formDialog: HTMLDialogElement;
	let loeschDialog: HTMLDialogElement;
	let formOffen = $state(false);
	let loeschOffen = $state(false);
	let bearbeitet = $state<number | null>(null);
	let stunde = $state('07');
	let minute = $state('00');
	let wiederholung = $state('WEEKDAYS');
	let stationId = $state('');
	let weckLautstaerke = $state(12);
	let loeschId = $state<number | null>(null);
	let loeschZeit = $state('');
	let laeuftGerade = $state(false);

	const vorschau = $derived.by(() => {
		const name = overtone.stations.find((st) => st.id === stationId)?.name ?? 'keinen Sender';
		return `Weckt ${stunde}:${minute} ${WIEDERHOLUNGSTEXT[wiederholung] ?? ''} mit ${name} auf Lautstärke ${weckLautstaerke}`;
	});

	$effect(() => {
		if (!formDialog) return;
		if (formOffen && !formDialog.open) formDialog.showModal();
		if (!formOffen && formDialog.open) formDialog.close();
	});

	$effect(() => {
		if (!loeschDialog) return;
		if (loeschOffen && !loeschDialog.open) loeschDialog.showModal();
		if (!loeschOffen && loeschDialog.open) loeschDialog.close();
	});

	function neuOeffnen() {
		bearbeitet = null;
		stunde = '07';
		minute = '00';
		wiederholung = 'WEEKDAYS';
		stationId = overtone.stations[0]?.id ?? '';
		weckLautstaerke = 12;
		formOffen = true;
	}

	function aendernOeffnen(w: Weckzeit) {
		bearbeitet = w.id;
		stunde = w.time.slice(0, 2);
		minute = w.time.slice(3, 5);
		wiederholung = w.recurrence;
		stationId = w.stationId || overtone.stations[0]?.id || '';
		weckLautstaerke = w.volume;
		formOffen = true;
	}

	function begrenzteLautstaerke(wert: number | null): number {
		if (wert === null || !Number.isFinite(wert)) return 0;
		return Math.max(0, Math.min(60, Math.round(wert)));
	}

	async function speichern() {
		laeuftGerade = true;
		const antwort = await overtone.alarmAktion({
			action: bearbeitet === null ? 'create' : 'update',
			id: bearbeitet ?? undefined,
			time: `${stunde}:${minute}`,
			recurrence: wiederholung,
			stationId,
			volume: begrenzteLautstaerke(weckLautstaerke)
		});
		laeuftGerade = false;
		if (antwort) {
			formOffen = false;
			overtone.hinweis(bearbeitet === null ? `Weckzeit ${stunde}:${minute} angelegt.` : 'Weckzeit geändert.');
		}
	}

	function loeschenFragen(w: Weckzeit) {
		loeschId = w.id;
		loeschZeit = w.time.slice(0, 5);
		loeschOffen = true;
	}

	async function loeschen() {
		if (loeschId === null) return;
		const antwort = await overtone.alarmAktion({ action: 'delete', id: loeschId });
		loeschOffen = false;
		loeschId = null;
		if (antwort) overtone.hinweis('Weckzeit gelöscht.');
	}
</script>

<div class="space-y-3">
	<button class="btn btn-primary btn-block h-14" onclick={neuOeffnen}>
		<Icon name="plus" groesse={20} />
		Neue Weckzeit
	</button>

	{#if overtone.weckzeiten.length}
		<ul class="space-y-2">
			{#each overtone.weckzeiten as w (w.id)}
				<li class="card bg-base-200">
					<div class="card-body gap-2 p-4">
						<div class="flex items-center justify-between gap-3">
							<div class="flex items-baseline gap-3">
								<span class="text-3xl font-semibold tabular-nums">{w.time.slice(0, 5)}</span>
								<span class="badge badge-sm {w.enabled ? 'badge-success' : 'badge-ghost'}">
									{w.enabled ? 'an' : 'aus'}
								</span>
							</div>
							<label class="flex cursor-pointer items-center gap-2 py-3 pl-2">
								<span class="sr-only">Weckzeit {w.time.slice(0, 5)} ein- oder ausschalten</span>
								<input
									class="toggle toggle-primary"
									type="checkbox"
									checked={w.enabled}
									onchange={() => overtone.alarmAktion({ action: w.enabled ? 'disable' : 'enable', id: w.id })}
								/>
							</label>
						</div>
						<p class="text-sm gedaempft">
							{WIEDERHOLUNGSTEXT[w.recurrence] ?? w.recurrence} · {w.stationName || w.label} · Lautstärke {w
								.volume}
						</p>
						<div class="flex gap-2">
							<button class="btn h-12 flex-1" onclick={() => aendernOeffnen(w)}>
								<Icon name="aendern" groesse={18} />
								ändern
							</button>
							<button
								class="btn h-12 w-12"
								aria-label="Weckzeit {w.time.slice(0, 5)} löschen"
								onclick={() => loeschenFragen(w)}>
								<Icon name="loeschen" groesse={18} />
							</button>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="card bg-base-200">
			<div class="card-body items-center gap-2 p-6 text-center">
				<Icon name="wecker" groesse={28} />
				{#if overtone.weckStoerung}
					<p class="text-sm gedaempft">
						{overtone.weckStoerung} Die Weckzeiten liegen im Lautsprecher, sie klingeln also auch ohne
						diese App.
					</p>
				{:else}
					<p class="text-sm gedaempft">
						Keine Weckzeit gespeichert. Weckzeiten liegen im Lautsprecher, sie klingeln also auch ohne
						diese App.
					</p>
				{/if}
			</div>
		</div>
	{/if}
</div>

<dialog bind:this={formDialog} class="modal modal-bottom sm:modal-middle" onclose={() => (formOffen = false)}>
	<div class="modal-box">
		<h2 class="text-lg font-semibold">{bearbeitet === null ? 'Neue Weckzeit' : 'Weckzeit ändern'}</h2>
		<div class="mt-4 space-y-3">
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Uhrzeit</legend>
				<div class="flex items-center gap-2">
					<label class="sr-only" for="stunde">Stunde</label>
					<select id="stunde" class="select w-24 text-center tabular-nums" bind:value={stunde}>
						{#each STUNDEN as h (h)}<option value={h}>{h}</option>{/each}
					</select>
					<span aria-hidden="true" class="text-lg gedaempft">:</span>
					<label class="sr-only" for="minute">Minute</label>
					<select id="minute" class="select w-24 text-center tabular-nums" bind:value={minute}>
						{#each MINUTEN as m (m)}<option value={m}>{m}</option>{/each}
					</select>
				</div>
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Wiederholung</legend>
				<select id="wiederholung" class="select w-full" bind:value={wiederholung}>
					<option value="ONCE">einmalig</option>
					<option value="WEEKDAYS">werktags</option>
					<option value="WEEKENDS">am Wochenende</option>
					<option value="DAILY">täglich</option>
				</select>
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Sender</legend>
				<select id="wecksender" class="select w-full" bind:value={stationId}>
					{#each overtone.stations as st (st.id)}<option value={st.id}>{st.name}</option>{/each}
				</select>
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Lautstärke (0 bis 60)</legend>
				<input
					id="weckvol"
					class="input w-full tabular-nums"
					type="number"
					min="0"
					max="60"
					bind:value={weckLautstaerke}
					onchange={() => (weckLautstaerke = begrenzteLautstaerke(weckLautstaerke))}
				/>
			</fieldset>
			<p class="rounded-box bg-base-300 px-3 py-2 text-sm" aria-live="polite">{vorschau}</p>
		</div>
		<div class="modal-action">
			<button class="btn btn-ghost" onclick={() => (formOffen = false)}>abbrechen</button>
			<button class="btn btn-primary" disabled={laeuftGerade} onclick={speichern}>
				{#if laeuftGerade}<span class="loading loading-spinner loading-sm"></span>{/if}
				{bearbeitet === null ? 'anlegen' : 'speichern'}
			</button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button>schließen</button>
	</form>
</dialog>

<dialog bind:this={loeschDialog} class="modal modal-bottom sm:modal-middle" onclose={() => (loeschOffen = false)}>
	<div class="modal-box">
		<h2 class="text-lg font-semibold">Weckzeit löschen?</h2>
		<p class="mt-1 text-sm gedaempft">Die Weckzeit {loeschZeit} wird aus dem Lautsprecher entfernt.</p>
		<div class="modal-action">
			<button class="btn btn-ghost" onclick={() => (loeschOffen = false)}>abbrechen</button>
			<button class="btn btn-error" onclick={loeschen}>
				<Icon name="loeschen" groesse={18} />
				ja, löschen
			</button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button>schließen</button>
	</form>
</dialog>
