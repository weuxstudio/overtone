<script lang="ts">
	import Icon from '#lib/client/Icon.svelte';
	import { overtone } from '#lib/client/overtone.svelte.ts';

	const laeuft = $derived(overtone.laeuft);
	const sender = $derived(overtone.laufenderSender?.name ?? '');
	const angaben = $derived(overtone.zustand.laufenderTitel);
	// Aus "Interpret - Titel" werden zwei Zeilen, wie in der Vorlage.
	const kuenstler = $derived(angaben.includes(' - ') ? angaben.split(' - ')[0] : sender);
	const titel = $derived(
		(angaben.includes(' - ') ? angaben.split(' - ').slice(1).join(' - ') : angaben) ||
			sender ||
			overtone.zustand.trackTitle ||
			(laeuft ? 'läuft' : 'nichts gestartet')
	);
	const zusatz = $derived(kuenstler || overtone.zustand.metaQuelle || (laeuft ? 'Live' : ''));

	// Fortschritt nur, wenn das Stueck eine bekannte Laenge hat.
	function sekunden(wert: string): number {
		const teile = wert.split(':').map(Number);
		if (teile.length !== 3 || teile.some((t) => Number.isNaN(t))) return 0;
		return teile[0] * 3600 + teile[1] * 60 + teile[2];
	}
	const fortschritt = $derived.by(() => {
		const ganz = sekunden(overtone.zustand.duration);
		const jetzt = sekunden(overtone.zustand.relTime);
		if (ganz <= 0) return null;
		return Math.max(0, Math.min(100, (jetzt / ganz) * 100));
	});
	const wiederholung = $derived(
		overtone.zustand.playMode === 'REPEAT_ALL'
			? 'alle'
			: overtone.zustand.playMode === 'REPEAT_ONE'
				? 'eins'
				: ''
	);

	function freigeben() {
		if (overtone.pinAnfordern('freigeben', 'Sperre freigeben', 'Der Code hebt die Sperre für 30 Minuten auf.')) {
			return;
		}
		void overtone.sperreAktion({ action: 'freigeben', minuten: 30 });
	}
</script>

<div class="flex flex-1 flex-col gap-3">
	{#if overtone.gesperrt}
		<section class="card border-error bg-error/10">
			<div class="card-body gap-2 p-4">
				<h2 class="text-lg font-semibold">{overtone.sperrtext}</h2>
				<p class="text-sm">
					{overtone.schutztext}
				</p>
				<button class="btn btn-primary btn-block h-12" onclick={freigeben}>
					<Icon name="check" groesse={18} />
					für 30 Minuten freigeben
				</button>
			</div>
		</section>
	{/if}

	<section class="relative overflow-hidden rounded-box">
		{#if overtone.zustand.cover}
			<img
				src={overtone.zustand.cover}
				alt=""
				class="absolute inset-0 h-full w-full scale-110 object-cover opacity-80 blur-xl saturate-150"
			/>
			<div class="absolute inset-0 bg-gradient-to-t from-neutral/95 via-neutral/85 to-neutral/60"></div>
		{:else}
			<div class="absolute inset-0 bg-base-200"></div>
		{/if}

		<div class="relative flex flex-col gap-4 p-4">
			<div class="flex items-center justify-between gap-2">
				<span class="badge badge-sm shrink-0 {laeuft ? 'badge-success' : 'badge-ghost'}">
					{overtone.zustandstext}
				</span>
				<span class="flex h-9 items-center gap-2 rounded-full border border-white/30 px-3 text-sm">
					<Icon name="geraet" groesse={16} />
					{overtone.zustand.zoneName ? `Auf ${overtone.zustand.zoneName}` : 'Auf dem Lautsprecher'}
				</span>
			</div>

			<div class="flex items-end justify-between gap-3">
				{#if overtone.zustand.cover}
					<img
						src={overtone.zustand.cover}
						alt=""
						class="h-16 w-16 shrink-0 rounded-xl object-cover shadow-lg"
					/>
				{/if}
				<div class="min-w-0 flex-1">
					<h2 class="text-2xl leading-tight font-bold break-words">{titel}</h2>
					{#if zusatz}
						<p class="mt-1 truncate text-base gedaempft">{zusatz}</p>
					{/if}
					{#if overtone.zustand.mute}
						<p class="mt-1 text-sm gedaempft">stumm</p>
					{/if}
					{#if !overtone.laeuft && overtone.zustand.lastError}
						<p class="mt-2 text-xs text-error">{overtone.zustand.lastError}</p>
					{/if}
				</div>
				<button
					class="btn h-14 w-24 shrink-0 rounded-2xl border-0 bg-white/85 text-black hover:bg-white"
					aria-label={laeuft ? 'Pause' : 'Wiedergabe'}
					onclick={() => overtone.befehl(laeuft ? 'pause' : 'play')}>
					<Icon name={laeuft ? 'pause' : 'play'} groesse={28} />
				</button>
			</div>

			<div class="flex items-center gap-1">
				<button
					class="btn btn-circle btn-ghost h-11 w-11"
					aria-label="Vorheriger Titel"
					onclick={() => overtone.befehl('previous')}>
					<Icon name="zurueck" groesse={20} />
				</button>
				<div class="min-w-0 flex-1 px-1">
					{#if fortschritt !== null}
						<div class="h-1 w-full rounded-full bg-white/25">
							<div class="h-1 rounded-full bg-white" style="width: {fortschritt}%"></div>
						</div>
						<div class="mt-1 flex justify-between text-xs gedaempft">
							<span>{overtone.zustand.relTime}</span>
							<span>{overtone.zustand.duration}</span>
						</div>
					{:else}
						<span class="text-xs gedaempft">
							{angaben ? 'Live vom Sender' : 'Live, kein Fortschritt'}
						</span>
					{/if}
				</div>
				<button
					class="btn btn-circle btn-ghost h-11 w-11"
					aria-label="Nächster Titel"
					onclick={() => overtone.befehl('next')}>
					<Icon name="weiter" groesse={20} />
				</button>
				<button
					class="btn btn-circle btn-ghost h-11 w-11 {overtone.zustand.playMode.includes('SHUFFLE') ? 'text-primary' : ''}"
					aria-pressed={overtone.zustand.playMode.includes('SHUFFLE')}
					aria-label="Zufallswiedergabe"
					onclick={() =>
						overtone.befehl(
							'playmode',
							overtone.zustand.playMode.includes('SHUFFLE') ? 'NORMAL' : 'SHUFFLE'
						)}>
					<Icon name="zufall" groesse={20} />
				</button>
				<button
					class="btn btn-circle btn-ghost h-11 w-11 {wiederholung ? 'text-primary' : ''}"
					aria-pressed={wiederholung !== ''}
					aria-label={wiederholung === 'eins' ? 'Wiederholen: eins' : wiederholung === 'alle' ? 'Wiederholen: alle' : 'Wiederholen'}
					onclick={() =>
						overtone.befehl(
							'playmode',
							wiederholung === '' ? 'REPEAT_ALL' : wiederholung === 'alle' ? 'REPEAT_ONE' : 'NORMAL'
						)}>
					<Icon name="wiederholen" groesse={20} />
				</button>
			</div>
		</div>
	</section>

	<section class="card bg-base-200">
		<div class="card-body gap-1 p-4">
			<div class="flex items-baseline justify-between">
				<label class="text-sm font-medium" for="vol">Lautstärke</label>
				{#if overtone.zustand.volume === null}
					<span class="text-sm gedaempft">noch unbekannt</span>
				{:else}
					<span class="text-2xl font-semibold tabular-nums">{overtone.lautstaerke}</span>
				{/if}
			</div>
			<div class="flex items-center gap-3">
				<input
					id="vol"
					class="range range-primary h-11 flex-1"
					aria-label="Lautstärke der Box"
					disabled={overtone.zustand.volume === null}
					type="range"
					min="0"
					max="60"
					value={overtone.lautstaerke}
					onpointerdown={() => (overtone.zieht = true)}
					onpointerup={() => (overtone.zieht = false)}
					onpointercancel={() => (overtone.zieht = false)}
					oninput={(e) => (overtone.lautstaerke = Number((e.currentTarget as HTMLInputElement).value))}
					onchange={(e) => {
						overtone.zieht = false;
						overtone.setzeLautstaerke(Number((e.currentTarget as HTMLInputElement).value));
					}}
				/>
			</div>
			<button
				class="btn btn-block mt-2 h-12 justify-start gap-3"
				disabled={overtone.zustand.volume === null}
				aria-pressed={overtone.zustand.mute}
				onclick={() => overtone.stummUmschalten()}>
				<Icon name={overtone.zustand.mute ? 'ton' : 'stumm'} groesse={19} />
				{overtone.zustand.mute ? 'Ton einschalten' : 'Stumm schalten'}
			</button>
		</div>
	</section>

	<section class="space-y-2">
		{#if overtone.zuletzt}
			<button
				class="btn btn-block h-14 justify-between border-base-300 bg-base-200"
				onclick={() => overtone.sende(overtone.zuletzt!.id)}>
				<span class="flex min-w-0 items-center gap-3">
					<Icon name="erneut" groesse={18} />
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
		<a class="btn btn-block h-14 justify-between border-base-300 bg-base-200" href="/sender">
			<span class="flex items-center gap-3">
				<Icon name="sender" groesse={18} />
				Alle Sender
			</span>
			<Icon name="weiterpfeil" groesse={18} />
		</a>
		<a class="btn btn-block h-14 justify-between border-base-300 bg-base-200" href="/wecker">
			<span class="flex items-center gap-3">
				<Icon name="wecker" groesse={18} />
				Weckzeiten
			</span>
			<span class="flex items-center gap-2">
				{#if overtone.weckzeiten.length}
					<span class="badge badge-ghost badge-sm">
						{overtone.weckzeiten.filter((w) => w.enabled).length} an
					</span>
				{/if}
				<Icon name="weiterpfeil" groesse={18} />
			</span>
		</a>
	</section>
</div>
