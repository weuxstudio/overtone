<script lang="ts">
	import Icon from '#lib/client/Icon.svelte';
	import { overtone, STUNDEN, MINUTEN, type Sperrfenster } from '#lib/client/overtone.svelte.ts';

	const TAGE = [
		{ nummer: 1, kurz: 'Mo' },
		{ nummer: 2, kurz: 'Di' },
		{ nummer: 3, kurz: 'Mi' },
		{ nummer: 4, kurz: 'Do' },
		{ nummer: 5, kurz: 'Fr' },
		{ nummer: 6, kurz: 'Sa' },
		{ nummer: 7, kurz: 'So' }
	];

	let formDialog: HTMLDialogElement;
	let pinDialog: HTMLDialogElement;
	let loeschDialog: HTMLDialogElement;
	let formOffen = $state(false);
	let pinOffen = $state(false);
	let loeschOffen = $state(false);
	let bearbeitet = $state<number | null>(null);
	let name = $state('');
	let tage = $state<number[]>([1, 2, 3, 4, 5]);
	let vonStunde = $state('20');
	let vonMinute = $state('00');
	let bisStunde = $state('06');
	let bisMinute = $state('30');
	let tasten = $state(true);
	let stumm = $state(true);
	let laeuft = $state(false);
	let pinNeu = $state('');
	let pinAlt = $state('');
	let pinFehler = $state('');
	let loeschId = $state<number | null>(null);
	let loeschName = $state('');
	let minuten = $state(60);

	const gesperrt = $derived(overtone.gesperrt);
	const freigabe = $derived(!!overtone.zustand.sperre?.freigabeBis);

	$effect(() => {
		if (!formDialog) return;
		if (formOffen && !formDialog.open) formDialog.showModal();
		if (!formOffen && formDialog.open) formDialog.close();
	});
	$effect(() => {
		if (!pinDialog) return;
		if (pinOffen && !pinDialog.open) pinDialog.showModal();
		if (!pinOffen && pinDialog.open) pinDialog.close();
	});
	$effect(() => {
		if (!loeschDialog) return;
		if (loeschOffen && !loeschDialog.open) loeschDialog.showModal();
		if (!loeschOffen && loeschDialog.open) loeschDialog.close();
	});

	function tagUmschalten(nummer: number) {
		tage = tage.includes(nummer) ? tage.filter((t) => t !== nummer) : [...tage, nummer].sort();
	}

	function neuOeffnen() {
		bearbeitet = null;
		name = '';
		tage = [1, 2, 3, 4, 5];
		vonStunde = '20';
		vonMinute = '00';
		bisStunde = '06';
		bisMinute = '30';
		tasten = true;
		stumm = true;
		formOffen = true;
	}

	function aendernOeffnen(f: Sperrfenster) {
		bearbeitet = f.id;
		name = f.name;
		tage = f.tage.length ? [...f.tage] : [1, 2, 3, 4, 5];
		vonStunde = f.von.slice(0, 2);
		vonMinute = f.von.slice(3, 5);
		bisStunde = f.bis.slice(0, 2);
		bisMinute = f.bis.slice(3, 5);
		tasten = f.tasten;
		stumm = f.stumm;
		formOffen = true;
	}

	async function speichern() {
		if (!tage.length) {
			overtone.melde('Bitte mindestens einen Wochentag wählen.');
			return;
		}
		laeuft = true;
		const antwort = await overtone.sperreAktion({
			action: bearbeitet === null ? 'create' : 'update',
			id: bearbeitet ?? undefined,
			name,
			tage,
			von: `${vonStunde}:${vonMinute}`,
			bis: `${bisStunde}:${bisMinute}`,
			tasten,
			stumm
		});
		laeuft = false;
		if (antwort) {
			formOffen = false;
			overtone.hinweis(bearbeitet === null ? 'Sperrzeit angelegt.' : 'Sperrzeit geändert.');
		}
	}

	async function fensterSchalten(f: Sperrfenster) {
		await overtone.sperreAktion({ action: 'update', id: f.id, aktiv: !f.aktiv });
	}

	function loeschenFragen(f: Sperrfenster) {
		loeschId = f.id;
		loeschName = f.name;
		loeschOffen = true;
	}

	async function loeschen() {
		if (loeschId === null) return;
		const antwort = await overtone.sperreAktion({ action: 'delete', id: loeschId });
		loeschOffen = false;
		loeschId = null;
		if (antwort) overtone.hinweis('Sperrzeit gelöscht.');
	}

	async function schnellSperren() {
		if (overtone.pinAnfordern('aendern', 'Schnellsperre', 'Der Code ist nötig, solange eine Sperre läuft.')) return;
		await overtone.sperreAktion({ action: 'schnell', minuten, tasten, stumm });
	}

	function freigabeAnfordern() {
		if (overtone.pinAnfordern('freigeben', 'Sperre freigeben', 'Der Code hebt die Sperre für eine Weile auf.')) {
			return;
		}
		void overtone.sperreAktion({ action: 'freigeben', minuten: 30 });
	}

	async function pinSpeichern() {
		if (!/^\d{4}$/.test(pinNeu)) {
			pinFehler = 'Vier Ziffern nötig.';
			return;
		}
		laeuft = true;
		const antwort = await overtone.sperreAktion({ action: 'pin', neu: pinNeu, alt: pinAlt });
		laeuft = false;
		if (antwort?.ok) {
			pinOffen = false;
			pinNeu = '';
			pinAlt = '';
			pinFehler = '';
			overtone.hinweis('Code gespeichert.');
		} else {
			pinFehler = String(antwort?.message ?? 'Falscher Code.');
		}
	}

	function zeitText(f: Sperrfenster) {
		const tageText = f.tage.length === 7 ? 'täglich' : f.tage.map((t) => TAGE[t - 1].kurz).join(', ');
		return `${tageText} von ${f.von} bis ${f.bis}`;
	}
</script>

<div class="space-y-3">
	<section class="card {gesperrt ? 'border-error bg-error/10' : 'bg-base-200'}">
		<div class="card-body gap-2 p-4">
			<div class="flex items-start justify-between gap-3">
				<h2 class="text-lg font-semibold">
					{gesperrt ? overtone.sperrtext : freigabe ? 'Freigegeben' : 'Nicht gesperrt'}
				</h2>
				<span class="badge badge-sm shrink-0 {gesperrt ? 'badge-error' : 'badge-ghost'}">
					{gesperrt ? 'gesperrt' : 'offen'}
				</span>
			</div>
			{#if gesperrt}
				<p class="text-sm">
					Wiedergabe gestoppt, Lautstärke auf null{tasten ? ', Tasten am Gerät gesperrt' : ''}. Startet jemand
					über Spotify oder die Sonos App, wird es binnen Sekunden wieder gestoppt.
				</p>
				<button class="btn btn-primary btn-block h-12" onclick={freigabeAnfordern}>
					<Icon name="check" groesse={18} />
					für 30 Minuten freigeben
				</button>
			{:else}
				<p class="text-sm gedaempft">
					{#if freigabe}
						{overtone.freigabeText}. Danach greift der Zeitplan wieder.
					{:else}
						Der Lautsprecher ist normal bedienbar. Sperrzeiten greifen nach Zeitplan.
					{/if}
				</p>
			{/if}
			{#if overtone.zustand.sperre?.gesperrt && overtone.zustand.sperre.freigabeBis}
				<p class="text-xs gedaempft">{overtone.freigabeText}</p>
			{/if}
		</div>
	</section>

	<section class="card bg-base-200">
		<div class="card-body gap-3 p-4">
			<label class="flex cursor-pointer items-center justify-between gap-3 py-1">
				<span class="text-sm font-medium">Kindersicherung insgesamt</span>
				<input
					class="toggle toggle-primary h-11 w-14"
					type="checkbox"
					checked={overtone.sperreGlobal}
					onchange={() => {
						if (gesperrt && overtone.pinAnfordern('aendern', 'Sicherung ausschalten', 'Code nötig.')) return;
						overtone.sperreAktion({ action: 'global', an: !overtone.sperreGlobal });
					}}
				/>
			</label>
			<div class="divider my-0"></div>
			<h3 class="text-sm font-medium">Schnellsperre</h3>
			<p class="text-sm gedaempft">Für den Moment, ohne Zeitplan.</p>
			<div class="flex flex-wrap gap-2">
				{#each [30, 60, 120, 240] as m (m)}
					<button
						class="btn h-12 flex-1 {minuten === m ? 'btn-primary' : ''}"
						onclick={() => (minuten = m)}>
						{m >= 60 ? `${m / 60} h` : `${m} min`}
					</button>
				{/each}
			</div>
			<button class="btn btn-block h-12" onclick={schnellSperren}>
				<Icon name="wecker" groesse={18} />
				jetzt sperren für {minuten >= 60 ? `${minuten / 60} Stunden` : `${minuten} Minuten`}
			</button>
		</div>
	</section>

	<section class="card bg-base-200">
		<div class="card-body gap-3 p-4">
			<div class="flex items-center justify-between">
				<h3 class="text-sm font-medium">Sperrzeiten</h3>
				<button class="btn h-11" onclick={neuOeffnen}>
					<Icon name="plus" groesse={16} />
					neu
				</button>
			</div>
			{#if overtone.fenster.length}
				{#each overtone.fenster as f (f.id)}
					<div class="rounded-box bg-base-300 p-3">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="font-medium">{f.name}</p>
								<p class="text-sm gedaempft">{f.einmalBis ? 'Schnellsperre' : zeitText(f)}</p>
								<p class="text-xs gedaempft">
									{f.tasten ? 'Tasten gesperrt' : 'Tasten frei'} · {f.stumm
										? 'Lautstärke auf null'
										: 'Lautstärke bleibt'}
								</p>
							</div>
							<input
								class="toggle toggle-primary mt-1 h-11 w-14"
								type="checkbox"
								checked={f.aktiv}
								aria-label="Sperrzeit {f.name} ein- oder ausschalten"
								onchange={() => fensterSchalten(f)}
							/>
						</div>
						<div class="mt-2 flex gap-2">
							<button class="btn h-11 flex-1" onclick={() => aendernOeffnen(f)}>
								<Icon name="aendern" groesse={16} />
								ändern
							</button>
							<button
								class="btn h-11 w-11"
								aria-label="Sperrzeit {f.name} löschen"
								onclick={() => loeschenFragen(f)}>
								<Icon name="loeschen" groesse={16} />
							</button>
						</div>
					</div>
				{/each}
			{:else}
				<p class="text-sm gedaempft">Noch keine Sperrzeit. Zum Beispiel werktags von 20:00 bis 06:30.</p>
			{/if}
		</div>
	</section>

	<section class="card bg-base-200">
		<div class="card-body gap-3 p-4">
			<h3 class="text-sm font-medium">Code</h3>
			<p class="text-sm gedaempft">
				{overtone.pinGesetzt
					? 'Ein Code ist gesetzt. Er ist nötig, solange eine Sperre läuft.'
					: 'Ohne Code kann jeder die Sperrzeiten ändern. Vier Ziffern genügen.'}
			</p>
			<button class="btn btn-block h-12" onclick={() => (pinOffen = true)}>
				<Icon name="aendern" groesse={18} />
				{overtone.pinGesetzt ? 'Code ändern' : 'Code setzen'}
			</button>
			<p class="text-xs gedaempft">
				Vergessener Code: er liegt nur auf diesem Rechner in ~/.overtone/overtone.db und kann dort gelöscht werden.
			</p>
		</div>
	</section>
</div>

<dialog bind:this={formDialog} class="modal modal-bottom sm:modal-middle" onclose={() => (formOffen = false)}>
	<div class="modal-box">
		<h2 class="text-lg font-semibold">{bearbeitet === null ? 'Neue Sperrzeit' : 'Sperrzeit ändern'}</h2>
		<div class="mt-4 space-y-3">
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Name</legend>
				<input class="input w-full" type="text" placeholder="z. B. Schule" bind:value={name} />
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Wochentage</legend>
				<div class="flex flex-wrap gap-2">
					{#each TAGE as t (t.nummer)}
						<button
							class="btn h-11 w-12 {tage.includes(t.nummer) ? 'btn-primary' : ''}"
							aria-pressed={tage.includes(t.nummer)}
							onclick={() => tagUmschalten(t.nummer)}>
							{t.kurz}
						</button>
					{/each}
				</div>
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Von</legend>
				<div class="flex items-center gap-2">
					<label class="sr-only" for="von-stunde">Stunde</label>
					<select id="von-stunde" class="select w-24 text-center tabular-nums" bind:value={vonStunde}>
						{#each STUNDEN as h (h)}<option value={h}>{h}</option>{/each}
					</select>
					<span aria-hidden="true" class="gedaempft">:</span>
					<label class="sr-only" for="von-minute">Minute</label>
					<select id="von-minute" class="select w-24 text-center tabular-nums" bind:value={vonMinute}>
						{#each MINUTEN as m (m)}<option value={m}>{m}</option>{/each}
					</select>
				</div>
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Bis</legend>
				<div class="flex items-center gap-2">
					<label class="sr-only" for="bis-stunde">Stunde</label>
					<select id="bis-stunde" class="select w-24 text-center tabular-nums" bind:value={bisStunde}>
						{#each STUNDEN as h (h)}<option value={h}>{h}</option>{/each}
					</select>
					<span aria-hidden="true" class="gedaempft">:</span>
					<label class="sr-only" for="bis-minute">Minute</label>
					<select id="bis-minute" class="select w-24 text-center tabular-nums" bind:value={bisMinute}>
						{#each MINUTEN as m (m)}<option value={m}>{m}</option>{/each}
					</select>
				</div>
			</fieldset>
			<label class="flex cursor-pointer items-center justify-between gap-3 py-2">
				<span class="text-sm">Tasten am Gerät sperren</span>
				<input class="toggle toggle-primary h-11 w-14" type="checkbox" bind:checked={tasten} />
			</label>
			<label class="flex cursor-pointer items-center justify-between gap-3 py-2">
				<span class="text-sm">Lautstärke auf null zwingen</span>
				<input class="toggle toggle-primary h-11 w-14" type="checkbox" bind:checked={stumm} />
			</label>
			<p class="rounded-box bg-base-300 px-3 py-2 text-sm">
				{tage.length ? tage.map((t) => TAGE[t - 1].kurz).join(', ') : 'kein Tag'} von {vonStunde}:{vonMinute} bis
				{bisStunde}:{bisMinute}
				{#if vonStunde > bisStunde || (vonStunde === bisStunde && vonMinute >= bisMinute)}
					· über Mitternacht
				{/if}
			</p>
		</div>
		<div class="modal-action">
			<button class="btn btn-ghost" onclick={() => (formOffen = false)}>abbrechen</button>
			<button class="btn btn-primary" disabled={laeuft} onclick={speichern}>
				{#if laeuft}<span class="loading loading-spinner loading-sm"></span>{/if}
				speichern
			</button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button class="h-full w-full cursor-default">schließen</button>
	</form>
</dialog>

<dialog bind:this={pinDialog} class="modal modal-bottom sm:modal-middle" onclose={() => (pinOffen = false)}>
	<div class="modal-box">
		<h2 class="text-lg font-semibold">Code {overtone.pinGesetzt ? 'ändern' : 'setzen'}</h2>
		<div class="mt-4 space-y-3">
			{#if overtone.pinGesetzt}
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Bisheriger Code</legend>
					<input
						class="input w-full text-center text-xl tracking-[0.4em] tabular-nums"
						type="text"
						inputmode="numeric"
						maxlength="4"
						bind:value={pinAlt}
					/>
				</fieldset>
			{/if}
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Neuer Code, vier Ziffern</legend>
				<input
					class="input w-full text-center text-xl tracking-[0.4em] tabular-nums"
					type="text"
					inputmode="numeric"
					maxlength="4"
					bind:value={pinNeu}
				/>
			</fieldset>
			{#if pinFehler}<p class="text-sm text-error" role="alert">{pinFehler}</p>{/if}
		</div>
		<div class="modal-action">
			<button class="btn btn-ghost" onclick={() => (pinOffen = false)}>abbrechen</button>
			<button class="btn btn-primary" disabled={laeuft} onclick={pinSpeichern}>speichern</button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button class="h-full w-full cursor-default">schließen</button>
	</form>
</dialog>

<dialog bind:this={loeschDialog} class="modal modal-bottom sm:modal-middle" onclose={() => (loeschOffen = false)}>
	<div class="modal-box">
		<h2 class="text-lg font-semibold">Sperrzeit löschen?</h2>
		<p class="mt-1 text-sm gedaempft">„{loeschName}“ wird entfernt.</p>
		<div class="modal-action">
			<button class="btn btn-ghost" onclick={() => (loeschOffen = false)}>abbrechen</button>
			<button class="btn btn-error" onclick={loeschen}>
				<Icon name="loeschen" groesse={18} />
				ja, löschen
			</button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button class="h-full w-full cursor-default">schließen</button>
	</form>
</dialog>
