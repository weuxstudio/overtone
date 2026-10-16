<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '#lib/client/Icon.svelte';
	import { overtone, RUHEZEIT_AUSWAHL, wiedergabeName } from '#lib/client/overtone.svelte.ts';

	let alsApp = $state(true);
	let ruheMinuten = $state(0);

	onMount(() => {
		alsApp = window.matchMedia('(display-mode: standalone)').matches;
	});

	let sicherungsDialog: HTMLDialogElement;
	let sicherungOffen = $state(false);
	let laeuft = $state(false);

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

	async function wiederherstellen() {
		laeuft = true;
		const antwort = await overtone.sendeAnfrage('/api/sicherung', { action: 'wiederherstellen' });
		laeuft = false;
		sicherungOffen = false;
		if (!antwort) return;
		overtone.hinweis(String(antwort.hinweis ?? 'Wiederhergestellt.'));
		void overtone.ladeSperre();
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
				<Icon name="ton" groesse={20} />
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
				<Icon name="wecker" groesse={20} />
			</span>
			<span class="min-w-0 flex-1">
				<span class="block font-medium">Kindersicherung</span>
				<span class="block text-sm gedaempft">
					{overtone.gesperrt
						? `${overtone.sperrtext}, Bedienung aus`
						: overtone.fenster.length
							? `${overtone.fenster.length} Sperrzeit${overtone.fenster.length === 1 ? '' : 'en'} eingerichtet`
							: 'Sperrzeiten für den Lautsprecher'}
				</span>
			</span>
			<span class="badge badge-sm shrink-0 {overtone.gesperrt ? 'badge-error' : 'badge-ghost'}">
				{overtone.gesperrt ? 'gesperrt' : 'offen'}
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
				<dt class="gedaempft">Adresse</dt>
				<dd class="break-all">{overtone.zustand.device || overtone.zustand.host || 'noch unbekannt'}</dd>
				<dt class="gedaempft">Zustand</dt>
				<dd>{overtone.zustandstext}</dd>
				<dt class="gedaempft">Lautstärke</dt>
				<dd class="tabular-nums">{overtone.lautstaerke}{overtone.zustand.mute ? ' · stumm' : ''}</dd>
				<dt class="gedaempft">Verbindung</dt>
				<dd class={overtone.zustand.lastError ? 'text-error' : ''}>{overtone.verbindungsText}</dd>
				<dt class="gedaempft">Ereignisse</dt>
				<dd class="tabular-nums">{overtone.zustand.events}</dd>
			</dl>
			{#if overtone.zustand.trackTitle}
				<p class="text-xs break-words gedaempft">Zuletzt: {overtone.zustand.trackTitle}</p>
			{/if}
		</div>
	</section>

	<section class="card bg-base-200">
		<div class="card-body gap-3 p-4">
			<h2 class="card-title text-base">
				<Icon name="timer" groesse={18} />
				Ruhe auf Zeit
			</h2>
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
				Sender, Szenen, Weckzeiten und Sperrzeiten als eine Datei auf diesem Rechner. Nach einem Werksreset lässt
				sich damit alles zurückspielen.
			</p>
			<div class="flex gap-2">
				<button class="btn h-12 flex-1" disabled={laeuft} onclick={sichern}>
					<Icon name="box" groesse={18} />
					sichern
				</button>
				<button class="btn h-12 flex-1" onclick={() => (sicherungOffen = true)}>wiederherstellen</button>
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
			<div class="flex gap-2">
				<button class="btn h-12 flex-1" onclick={neuLaden}>
					<Icon name="erneut" groesse={18} />
					neu laden
				</button>
				<a class="btn h-12 flex-1" href="/api/state" target="_blank" rel="noreferrer">
					Rohdaten
				</a>
			</div>
			<p class="text-xs gedaempft">
				Dienst auf diesem Rechner, Zugang nur im eigenen Netz. Kein Passwort nötig, weil nichts nach außen
				offen ist.
			</p>
		</div>
	</section>
</div>

<dialog bind:this={sicherungsDialog} class="modal modal-bottom sm:modal-middle" onclose={() => (sicherungOffen = false)}>
	<div class="modal-box">
		<h2 class="text-lg font-semibold">Sicherung zurückspielen?</h2>
		<p class="mt-1 text-sm gedaempft">
			Die jüngste Sicherung wird eingelesen. Szenen und Weckzeiten kommen dabei neu hinzu, vorhandene bleiben
			stehen. Vorher sichern, wenn der Stand wichtig ist.
		</p>
		<div class="modal-action">
			<button class="btn btn-ghost" onclick={() => (sicherungOffen = false)}>abbrechen</button>
			<button class="btn btn-primary" disabled={laeuft} onclick={wiederherstellen}>
				{#if laeuft}<span class="loading loading-spinner loading-sm"></span>{/if}
				ja, zurückspielen
			</button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button class="h-full w-full cursor-default">schließen</button>
	</form>
</dialog>
