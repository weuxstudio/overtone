<script lang="ts">
	import Icon from '#lib/client/Icon.svelte';
	import { overtone } from '#lib/client/overtone.svelte.ts';

	let formDialog: HTMLDialogElement;
	let loeschDialog: HTMLDialogElement;
	let formOffen = $state(false);
	let loeschOffen = $state(false);
	let name = $state('');
	let bearbeitet = $state<number | null>(null);
	let loeschId = $state<number | null>(null);
	let loeschName = $state('');
	let laeuftGerade = $state(false);

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
		name = '';
		formOffen = true;
	}

	function aendernOeffnen(id: number, bisher: string) {
		bearbeitet = id;
		name = bisher;
		formOffen = true;
	}

	async function speichern() {
		if (!name.trim()) {
			overtone.melde('Bitte einen Namen eingeben.');
			return;
		}
		laeuftGerade = true;
		const antwort =
			bearbeitet === null
				? await overtone.szenenAktion({ action: 'create', name: name.trim(), fromCurrent: true })
				: await overtone.szenenAktion({ action: 'rename', id: bearbeitet, name: name.trim() });
		laeuftGerade = false;
		if (antwort) {
			formOffen = false;
			overtone.hinweis(bearbeitet === null ? 'Szene gesichert.' : 'Name geändert.');
		}
	}

	function loeschenFragen(id: number, szenenName: string) {
		loeschId = id;
		loeschName = szenenName;
		loeschOffen = true;
	}

	async function loeschen() {
		if (loeschId === null) return;
		const antwort = await overtone.szenenAktion({ action: 'delete', id: loeschId });
		loeschOffen = false;
		loeschId = null;
		if (antwort) overtone.hinweis('Szene gelöscht.');
	}
</script>

<div class="space-y-3">
	<button class="btn btn-primary btn-block h-14" onclick={neuOeffnen}>
		<Icon name="plus" groesse={20} />
		Neue Szene sichern
	</button>

	{#if overtone.szenen.length}
		<div class="space-y-2">
			{#each overtone.szenen as sz (sz.id)}
				<div class="card bg-base-200">
					<div class="card-body gap-2 p-4">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<h2 class="truncate text-lg font-semibold">{sz.name}</h2>
								<p class="text-sm gedaempft">
									{sz.stationName}{sz.volume !== null ? ` · Lautstärke ${sz.volume}` : ''}
								</p>
							</div>
							<span class="badge badge-ghost badge-sm shrink-0">Szene</span>
						</div>
						<div class="flex gap-2">
							<button
								class="btn btn-primary h-12 flex-1"
								disabled={overtone.startend === 'szene-' + sz.id}
								onclick={() => overtone.szeneAnwenden(sz)}>
								{#if overtone.startend === 'szene-' + sz.id}
									<span class="loading loading-spinner loading-sm"></span>
									wird angewandt
								{:else}
									<Icon name="play" groesse={18} />
									anwenden
								{/if}
							</button>
							<button
								class="btn h-12 w-12"
								aria-label="Szene {sz.name} umbenennen"
								onclick={() => aendernOeffnen(sz.id, sz.name)}>
								<Icon name="aendern" groesse={18} />
							</button>
							<button
								class="btn h-12 w-12"
								aria-label="Szene {sz.name} löschen"
								onclick={() => loeschenFragen(sz.id, sz.name)}>
								<Icon name="loeschen" groesse={18} />
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="card bg-base-200">
			<div class="card-body items-center gap-2 p-6 text-center">
				<Icon name="szenen" groesse={28} />
				<p class="text-sm gedaempft">
					Noch keine Szene gesichert. Eine Szene hält Sender, Lautstärke, Klang und Wiedergabeart fest.
				</p>
			</div>
		</div>
	{/if}
</div>

<dialog bind:this={formDialog} class="modal modal-bottom sm:modal-middle" onclose={() => (formOffen = false)}>
	<div class="modal-box">
		<h2 class="text-lg font-semibold">{bearbeitet === null ? 'Neue Szene sichern' : 'Szene umbenennen'}</h2>
		{#if bearbeitet === null}
			<p class="mt-1 text-sm gedaempft">
				Gesichert wird der aktuelle Zustand: Sender, Lautstärke, Klang und Wiedergabeart.
			</p>
		{/if}
		<div class="mt-4 flex flex-col gap-1">
			<label class="text-sm font-medium" for="szenenname">Name</label>
			<input
				id="szenenname"
				class="input input-bordered w-full"
				type="text"
				placeholder="z. B. Abend"
				bind:value={name}
			/>
		</div>
		<div class="modal-action">
			<button class="btn btn-ghost" onclick={() => (formOffen = false)}>abbrechen</button>
			<button class="btn btn-primary" disabled={laeuftGerade} onclick={speichern}>
				{#if laeuftGerade}<span class="loading loading-spinner loading-sm"></span>{/if}
				{bearbeitet === null ? 'sichern' : 'speichern'}
			</button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button>schließen</button>
	</form>
</dialog>

<dialog bind:this={loeschDialog} class="modal modal-bottom sm:modal-middle" onclose={() => (loeschOffen = false)}>
	<div class="modal-box">
		<h2 class="text-lg font-semibold">Szene löschen?</h2>
		<p class="mt-1 text-sm gedaempft">„{loeschName}“ wird entfernt. Das lässt sich nicht rückgängig machen.</p>
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
