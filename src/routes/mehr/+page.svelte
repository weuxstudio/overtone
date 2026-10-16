<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '#lib/client/Icon.svelte';
	import { overtone, RUHEZEIT_AUSWAHL, wiedergabeName } from '#lib/client/overtone.svelte.ts';
	import {
		istSicherungsbericht, istVorschau,
		sicherungsFehlermeldung,
		WIEDERHERSTELLUNG_UNGEKLAERT
	} from '#lib/client/sicherung';

	import type { Vorschau, Importentscheidungen, Importoptionen } from '#lib/sicherung';
	import type { Sicherungsbericht } from '#lib/client/sicherung';
	let alsApp = $state(true);
	let ruheMinuten = $state(0);

	onMount(() => {
		alsApp = window.matchMedia('(display-mode: standalone)').matches;
	});

	let sicherungsDialog: HTMLDialogElement;
	let sicherungOffen = $state(false);
	let laeuft = $state(false);
	let pinwert = $state('');
	let pinFehler = $state('');
	let sicherungsFehler = $state('');
    let vorschau = $state<Vorschau | null>(null);
    let importbericht = $state<Sicherungsbericht | null>(null);
    let entscheidungen = $state<Importentscheidungen>({});
    let optionen = $state<Importoptionen>({});
    let quellDatei = $state('');
    let quellInhalt = $state<unknown>(undefined);
    let quellName = $state('Jüngste Sicherung auf diesem Rechner');
    const entscheidungenOffen = $derived(vorschau?.eintraege.some(e => ['konflikt','ungeklaert','ungueltig'].includes(e.zustand) && !entscheidungen[e.schluessel]));
    const bereichName = { sender: 'Sender', szenen: 'Szene', weckzeiten: 'Weckzeit', sperrzeiten: 'Sperrzeit' };
    const ergebnisName = { uebernommen: 'Übernommen', uebersprungen: 'Übersprungen', fehlgeschlagen: 'Fehlgeschlagen', ungeklaert: 'Ungeklärt' };
    function sicherungOeffnen() {
        vorschau = null; importbericht = null; entscheidungen = {}; optionen = {}; quellDatei = ''; quellInhalt = undefined;
        quellName = 'Jüngste Sicherung auf diesem Rechner'; sicherungsFehler = ''; pinFehler = ''; sicherungOffen = true;
    }
    async function dateiWaehlen(event: Event) {
        const datei = (event.target as HTMLInputElement).files?.[0];
        if (!datei) return;
        vorschau = null; importbericht = null; entscheidungen = {}; quellDatei = ''; sicherungsFehler = '';
        try { quellInhalt = JSON.parse(await datei.text()); quellName = datei.name; }
        catch { quellInhalt = null; quellName = datei.name; sicherungsFehler = 'Die gewählte Datei enthält kein lesbares JSON.'; }
    }

	$effect(() => {
		if (!sicherungsDialog) return;
		if (sicherungOffen && !sicherungsDialog.open) sicherungsDialog.showModal();
		if (!sicherungOffen && sicherungsDialog.open) sicherungsDialog.close();
	});

	function neuLaden() {
		location.reload();
	}

	async function sichern() {
		laeuft = true;
		const antwort = await overtone.hole('/api/sicherung');
		laeuft = false;
		if (!antwort) return;
		const a = antwort.anzahl as Record<string, number>;
		overtone.hinweis(
			`Sicherung geschrieben: ${a.sender} Sender, ${a.szenen} Szenen, ${a.weckzeiten} Weckzeiten, ${a.sperrzeiten} Sperrzeiten.`
		);
	}

    async function importAnfrage(anwenden = false) {
        laeuft = true; pinFehler = ''; sicherungsFehler = '';
        const daten = { action: anwenden ? 'wiederherstellen' : 'vorpruefen', pin: pinwert.trim(),
            ...(quellInhalt !== undefined ? { inhalt: quellInhalt } : quellDatei ? { datei: quellDatei } : {}),
            ...(anwenden ? { token: vorschau?.token, optionen, entscheidungen } : {}) };
        try {
            const antwort = await fetch('/api/sicherung', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(daten) });
            const roh: unknown = await antwort.json().catch(() => null);
            if (antwort.status === 403) { pinFehler = sicherungsFehlermeldung(roh,'Falscher Code.'); return; }
            if (roh && typeof roh === 'object' && 'datei' in roh && typeof roh.datei === 'string') quellDatei = roh.datei;
            if (istVorschau(roh)) { vorschau = roh; importbericht = null; entscheidungen = {}; return; }
            if (antwort.status === 409 && roh && typeof roh === 'object' && 'vorschau' in roh && istVorschau(roh.vorschau)) {
                vorschau = roh.vorschau; entscheidungen = {}; importbericht = null;
                sicherungsFehler = 'Der Bestand oder Importstand hat sich geändert. Die aktualisierte Vorschau erneut prüfen.'; return;
            }
            if (!antwort.ok) { sicherungsFehler = sicherungsFehlermeldung(roh,WIEDERHERSTELLUNG_UNGEKLAERT); return; }
            if (!istSicherungsbericht(roh)) { sicherungsFehler = WIEDERHERSTELLUNG_UNGEKLAERT; return; }
            importbericht = roh; vorschau = null;
            void overtone.ladeSender(); void overtone.ladeWeckzeiten(); void overtone.ladeSzenen(); void overtone.ladeSperre();
        } catch { sicherungsFehler = WIEDERHERSTELLUNG_UNGEKLAERT; }
        finally { laeuft = false; }
    }

</script>

<div class="space-y-3">
	<a href="/ton" class="card bg-base-200" aria-label="Ansagen und Klänge öffnen">
		<div class="card-body flex-row items-center gap-3 p-4">
			<span class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-base-300">
				<Icon name="ton" groesse={20} />
			</span>
			<span class="min-w-0 flex-1">
				<span class="block font-medium">Ansagen und Klänge</span>
				<span class="block text-sm gedaempft">
					Text vorlesen lassen, Regen und Meer zum Einschlafen
				</span>
			</span>
			<Icon name="weiterpfeil" groesse={18} />
		</div>
	</a>

	<a href="/klang" class="card bg-base-200" aria-label="Klang und Wiedergabe öffnen">
		<div class="card-body flex-row items-center gap-3 p-4">
			<span class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-base-300">
				<Icon name="welle" groesse={20} />
			</span>
			<span class="min-w-0 flex-1">
				<span class="block font-medium">Klang und Wiedergabe</span>
				<span class="block text-sm gedaempft">
					Bass {typeof overtone.zustand.klang?.bass === 'number'
						? `${overtone.zustand.klang.bass > 0 ? '+' : ''}${overtone.zustand.klang.bass}`
						: 'unbekannt'}, Höhen {typeof overtone.zustand.klang?.treble === 'number'
						? `${overtone.zustand.klang.treble > 0 ? '+' : ''}${overtone.zustand.klang.treble}`
						: 'unbekannt'}, Wiedergabe {wiedergabeName(overtone.zustand.playMode).toLowerCase()}
				</span>
			</span>
			<Icon name="weiterpfeil" groesse={18} />
		</div>
	</a>

	<a
		href="/sperre"
		class="card bg-base-200 {overtone.gesperrt ? 'border-error' : ''}"
		aria-label="Kindersicherung öffnen">
		<div class="card-body flex-row items-center gap-3 p-4">
			<span class="grid h-11 w-11 shrink-0 place-items-center rounded-full {overtone.gesperrt
				? 'bg-error/20 text-error'
				: 'bg-base-300'}">
				<Icon name="schloss" groesse={20} />
			</span>
			<span class="min-w-0 flex-1">
				<span class="block font-medium">Kindersicherung</span>
				<span class="block text-sm gedaempft">
					{overtone.gesperrt
						? overtone.schutztext
						: overtone.fenster.length
							? `${overtone.fenster.length} Sperrzeit${overtone.fenster.length === 1 ? '' : 'en'} eingerichtet`
							: 'Sperrzeiten für den Lautsprecher'}
				</span>
			</span>
			<span class="badge badge-sm shrink-0 {overtone.gesperrt ? 'badge-error' : 'badge-ghost'}">
				{overtone.gesperrt ? 'vorgesehen' : 'kein Zeitfenster'}
			</span>
		</div>
	</a>

	<section class="card bg-base-200">
		<div class="card-body gap-3 p-4">
			<h2 class="card-title text-base">
				<Icon name="geraet" groesse={18} />
				Lautsprecher
			</h2>
			<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
				<dt class="gedaempft">Raum</dt>
				<dd>{overtone.zustand.zoneName}</dd>
				<dt class="gedaempft">Zustand</dt>
				<dd>{overtone.zustandstext}</dd>
				<dt class="gedaempft">Lautstärke</dt>
				<dd class="tabular-nums">{overtone.lautstaerke}{overtone.zustand.mute ? ' · stumm' : ''}</dd>
				<dt class="gedaempft">Verbindung</dt>
				<dd class={overtone.verbindungsText === 'nicht erreichbar' ? 'text-error' : ''}>
					{overtone.verbindungsText}
				</dd>
			</dl>
			{#if overtone.zustand.trackTitle}
				<p class="text-xs break-words gedaempft">Zuletzt: {overtone.zustand.trackTitle}</p>
			{/if}
			<details class="text-sm">
				<summary class="cursor-pointer py-1 gedaempft select-none">Technische Angaben</summary>
				<dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
					<dt class="gedaempft">Adresse</dt>
					<dd class="break-all">{overtone.zustand.device || overtone.zustand.host || 'noch unbekannt'}</dd>
					<dt class="gedaempft">Ereignisse</dt>
					<dd class="tabular-nums">{overtone.zustand.events}</dd>
				</dl>
				<a class="link mt-2 inline-block gedaempft" href="/api/state" target="_blank" rel="noreferrer">
					Rohdaten ansehen
				</a>
			</details>

			<h3 class="mt-1 flex items-center gap-2 text-sm font-medium">
				<Icon name="timer" groesse={16} />
				Ruhe auf Zeit
			</h3>
			<p class="text-sm gedaempft">
				Der Lautsprecher hält nach der gewählten Zeit an. Nützlich zum Einschlafen.
			</p>
			<div class="flex flex-wrap gap-2">
				{#each RUHEZEIT_AUSWAHL as m (m)}
					<button
						class="btn h-12 flex-1 {ruheMinuten === m ? 'btn-primary' : ''}"
						onclick={() => {
							ruheMinuten = m;
							overtone.ruhe(m);
						}}>
						{m} min
					</button>
				{/each}
			</div>
			<button
				class="btn btn-ghost btn-block h-12"
				onclick={() => {
					ruheMinuten = 0;
					overtone.ruhe(0);
				}}>
				Ruhe aufheben
			</button>
		</div>
	</section>

	<section class="card bg-base-200">
		<div class="card-body gap-3 p-4">
			<h2 class="card-title text-base">
				<Icon name="box" groesse={18} />
				Sicherung
			</h2>
			<p class="text-sm gedaempft">
				Sender, Szenen, Weckzeiten und Sperrzeiten als eine Datei auf diesem Rechner. Vor der Wiederherstellung zeigt eine Vorschau die geplanten Übernahmen und mögliche Konflikte.
			</p>
			<div class="flex gap-2">
				<button class="btn h-12 flex-1" disabled={laeuft} onclick={sichern}>
					<Icon name="box" groesse={18} />
					sichern
				</button>
				<button class="btn h-12 flex-1" onclick={sicherungOeffnen}>wiederherstellen</button>
			</div>
		</div>
	</section>

	<section class="card bg-base-200">
		<div class="card-body gap-3 p-4">
			<h2 class="card-title text-base">
				<Icon name="info" groesse={18} />
				App
			</h2>
			{#if alsApp}
				<p class="text-sm gedaempft">Läuft als App auf dem Startbildschirm.</p>
			{:else}
				<p class="text-sm gedaempft">
					Zum Ablegen auf dem Startbildschirm: im Browser das Teilen-Symbol öffnen und „Zum Home-Bildschirm“
					wählen.
				</p>
			{/if}
			<button class="btn btn-block h-12" onclick={neuLaden}>
				<Icon name="erneut" groesse={18} />
				neu laden
			</button>
			<p class="text-xs gedaempft">
				Dienst auf diesem Rechner, Zugang nur im eigenen Netz. Kein Passwort nötig, weil nichts nach außen
				offen ist.
			</p>
		</div>
	</section>
</div>

<dialog bind:this={sicherungsDialog} class="modal modal-bottom sm:modal-middle" onclose={() => (sicherungOffen = false)}>
	<div class="modal-box">
		<h2 class="text-lg font-semibold">Sicherung wiederherstellen</h2>
        <p class="mt-1 text-sm gedaempft">Vorhandene Einträge und lokale Änderungen bleiben erhalten. Unklare Zuordnungen werden vor der Übernahme geklärt.</p>
        <p class="mt-3 text-sm">Quelle: {quellName}</p>
        <label class="mt-2 block text-sm" for="sicherungsdatei">Andere Sicherungsdatei wählen</label>
        <input id="sicherungsdatei" class="file-input mt-1 w-full" type="file" accept=".json,application/json" disabled={laeuft} onchange={dateiWaehlen} />

		{#if overtone.pinGesetzt}
			<div class="mt-3">
				<label class="mb-1 block text-sm font-medium" for="sicherung-pin">
					Kindersicherungs-Code
				</label>
				<input
					id="sicherung-pin"
					type="password"
					inputmode="numeric"
					maxlength="4"
					class="input input-bordered w-28 tracking-[0.4em] text-center"
					placeholder="0000"
					bind:value={pinwert} />
				{#if pinFehler}
					<p class="mt-1 text-sm text-error" role="alert">{pinFehler}</p>
				{/if}
			</div>
		{/if}
		{#if sicherungsFehler}
			<p class="mt-3 text-sm text-error" role="alert">{sicherungsFehler}</p>
		{/if}
        {#if vorschau}
            <section class="mt-4 space-y-3" aria-label="Importvorschau">
                <h3 class="font-medium">Geplante Übernahmen</h3>
                {#if vorschau.alt}<p class="text-sm gedaempft">Diese ältere Sicherung enthält keine eindeutige Herkunft. Neue Einträge und Zuordnungen ausdrücklich auswählen.</p>{/if}
                {#each vorschau.eintraege as e (e.schluessel)}
                    <div class="border-base-300 border-b pb-3">
                        <p class="text-sm font-medium">{e.name} <span class="gedaempft">({bereichName[e.art]})</span></p>
                        <p class="text-sm gedaempft">{e.text}</p>
                        {#if ['konflikt','ungeklaert','ungueltig'].includes(e.zustand)}
                            <label class="mt-2 block text-sm" for={'entscheidung-' + e.schluessel}>Entscheidung für {e.name}</label>
                            <select id={'entscheidung-' + e.schluessel} class="select mt-1 w-full" disabled={laeuft} bind:value={entscheidungen[e.schluessel]}>
                                <option value="">Entscheidung auswählen</option>
                                <option value="ueberspringen">Überspringen und Bestand erhalten</option>
                                {#if e.zustand !== 'ungueltig'}
                                    {#each e.ziele as ziel (ziel.id)}<option value={'zuordnen:' + ziel.id}>Vorhanden: {ziel.name}</option>{/each}
                                    <option value="neu">{e.zustand === 'ungeklaert' ? 'Als nicht angelegt geprüft, neu anlegen' : 'Als neuen Eintrag übernehmen'}</option>
                                {/if}
                            </select>
                        {/if}
                    </div>
                {/each}
                {#if !vorschau.eintraege.length}<p class="text-sm">Die Sicherung enthält keine übernehmbaren Einträge.</p>{/if}
                <fieldset class="space-y-2" disabled={laeuft}>
                    <legend class="mb-2 text-sm font-medium">Zusätzliche Übernahmen</legend>
                    <label class="flex items-center gap-2 text-sm"><input class="checkbox" type="checkbox" bind:checked={optionen.klang} />Klang übernehmen</label>
                    <label class="flex items-center gap-2 text-sm"><input class="checkbox" type="checkbox" bind:checked={optionen.wiedergabeart} />Wiedergabeart übernehmen</label>
                    <label class="flex items-center gap-2 text-sm"><input class="checkbox" type="checkbox" bind:checked={optionen.zeitplan} />Schalter für den regulären Zeitplan übernehmen</label>
                    <label class="flex items-center gap-2 text-sm"><input class="checkbox" type="checkbox" bind:checked={optionen.aktivieren} />Gespeicherte Aktivierung neuer Weckzeiten und Sperrzeiten übernehmen</label>
                </fieldset>
                <p class="text-xs gedaempft">Ohne diese Auswahl bleiben Einstellungen unverändert und neue Zeitpläne deaktiviert.</p>
            </section>
        {/if}
        {#if importbericht}
            <section class="mt-4 space-y-2" aria-label="Importbericht" aria-live="polite">
                <h3 class="font-medium">Ergebnis der Wiederherstellung</h3>
                <p class="text-sm">{importbericht.hinweis}</p>
                {#each importbericht.ergebnisse ?? [] as ergebnis}
                    <p class="text-sm"><strong>{ergebnisName[ergebnis.zustand]}: {ergebnis.name}.</strong> {#if ergebnis.zustand !== 'uebernommen'}{ergebnis.text}{/if}</p>
                {/each}
                {#each importbericht.fehler.filter(f => !(importbericht?.ergebnisse ?? []).some(e => f === `${bereichName[e.art]} ${e.name}: ${e.text}`)) as fehler}<p class="text-sm text-error">{fehler}</p>{/each}
            </section>
        {/if}
		<div class="modal-action">
			<button
				class="btn btn-ghost"
				onclick={() => {
					sicherungOffen = false;
					pinFehler = '';
					sicherungsFehler = '';
					pinwert = '';
				}}>
				Schließen
			</button>
			<button class="btn btn-primary" disabled={laeuft || (!!vorschau && entscheidungenOffen)} onclick={() => importAnfrage(!!vorschau)}>
				{#if laeuft}<span class="loading loading-spinner loading-sm"></span>{/if}
				{vorschau ? 'Auswahl übernehmen' : importbericht ? 'Importstand erneut prüfen' : 'Vorprüfung starten'}
			</button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button class="h-full w-full cursor-default">schließen</button>
	</form>
</dialog>
