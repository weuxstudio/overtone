<script lang="ts">
	import { overtone } from '#lib/client/overtone.svelte.ts';
	import Icon from '#lib/client/Icon.svelte';

	let dialog: HTMLDialogElement;
	let pin = $state('');
	let fehler = $state('');
	let laeuft = $state(false);

	const offen = $derived(!!overtone.pinAnforderung);

	$effect(() => {
		if (!dialog) return;
		if (offen && !dialog.open) {
			pin = '';
			fehler = '';
			dialog.showModal();
		}
		if (!offen && dialog.open) dialog.close();
	});

	async function bestaetigen() {
		const a = overtone.pinAnforderung;
		if (!a) return;
		if (!/^\d{4}$/.test(pin)) {
			fehler = 'Vier Ziffern nötig.';
			return;
		}
		laeuft = true;
		const antwort = await overtone.sperreAktion(
			a.zweck === 'freigeben'
				? { action: 'freigeben', minuten: a.minuten }
				: { action: 'freigabeAufheben' },
			pin
		);
		laeuft = false;
		if (antwort?.ok) {
			overtone.pinAnforderung = null;
		} else {
			fehler = String(antwort?.message ?? 'Falscher Code.');
			pin = '';
		}
	}

	function schliessen() {
		overtone.pinAnforderung = null;
	}
</script>

<dialog bind:this={dialog} class="modal modal-bottom sm:modal-middle" onclose={schliessen}>
	<div class="modal-box">
		<h2 class="text-lg font-semibold">{overtone.pinAnforderung?.titel ?? 'Code'}</h2>
		<p class="mt-1 text-sm gedaempft">{overtone.pinAnforderung?.text ?? ''}</p>
		<div class="mt-4 flex flex-col gap-1">
			<label class="text-sm font-medium" for="code">Code, vier Ziffern</label>
			<input
				id="code"
				class="input w-full text-center text-2xl tracking-[0.5em] tabular-nums"
				type="text"
				inputmode="numeric"
				autocomplete="off"
				maxlength="4"
				bind:value={pin}
				onkeydown={(e) => e.key === 'Enter' && bestaetigen()}
			/>
			{#if fehler}
				<p class="text-sm text-error" role="alert">{fehler}</p>
			{/if}
		</div>
		<div class="modal-action">
			<button class="btn btn-ghost" onclick={schliessen}>abbrechen</button>
			<button class="btn btn-primary" disabled={laeuft} onclick={bestaetigen}>
				{#if laeuft}<span class="loading loading-spinner loading-sm"></span>{/if}
				<Icon name="check" groesse={18} />
				freigeben
			</button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button class="h-full w-full cursor-default">schließen</button>
	</form>
</dialog>
