<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import Icon from '#lib/client/Icon.svelte';
	import PinDialog from '#lib/client/PinDialog.svelte';
	import Toasts from '#lib/client/Toasts.svelte';
	import { overtone } from '#lib/client/overtone.svelte.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const titel: Record<string, string> = {
		'/': 'Overtone',
		'/sender': 'Sender',
		'/szenen': 'Szenen',
		'/wecker': 'Weckzeiten',
		'/klang': 'Klang',
		'/ton': 'Ansagen und Klänge',
		'/sperre': 'Kindersicherung',
		'/mehr': 'Mehr'
	};

	const bereiche = [
		{ pfad: '/', name: 'Start', icon: 'start' },
		{ pfad: '/sender', name: 'Sender', icon: 'sender' },
		{ pfad: '/wecker', name: 'Wecker', icon: 'wecker' },
		{ pfad: '/szenen', name: 'Szenen', icon: 'szenen' },
		{ pfad: '/mehr', name: 'Mehr', icon: 'mehr' }
	];

	const seite = $derived(titel[page.url.pathname] ?? 'Overtone');
	const istAktiv = (pfad: string) =>
		pfad === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(pfad);

	onMount(() => overtone.start());
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{seite}</title>
</svelte:head>

<div class="flex min-h-dvh flex-col bg-base-100 text-base-content">
	<header
		class="sticky top-0 z-40 border-b border-base-300 bg-base-100/92 pt-[env(safe-area-inset-top)] backdrop-blur">
		<div class="mx-auto flex h-14 w-full max-w-[42rem] items-center justify-between px-4">
			<div class="flex items-baseline gap-2">
				<h1 class="text-lg font-semibold tracking-tight">{seite}</h1>
				{#if seite !== 'Overtone'}
					<span class="text-xs gedaempft">{overtone.zustand.zoneName}</span>
				{/if}
			</div>
			{#if overtone.gesperrt}
				<span class="badge badge-sm badge-error gap-1" title="Kindersicherung aktiv">
					<Icon name="wecker" groesse={13} />
					{overtone.sperrtext}
				</span>
			{:else}
				<span
					class="badge badge-sm gap-1 {overtone.zustand.lastError
						? 'badge-error'
						: overtone.bereit
							? 'badge-success'
							: 'badge-ghost'}"
					title="Zustand der Verbindung">
					<Icon name="welle" groesse={13} />
					{overtone.verbindungsText}
				</span>
			{/if}
		</div>
	</header>

	<main
		class="mx-auto flex w-full max-w-[42rem] flex-1 flex-col px-4 pb-[calc(4.75rem+env(safe-area-inset-bottom))] pt-3">
		{@render children()}
	</main>

	<nav
		class="dock dock-md z-50 border-t border-base-300 pb-[max(env(safe-area-inset-bottom),0.4rem)] text-base-content"
		aria-label="Bereiche">
		{#each bereiche as b (b.pfad)}
			<a
				href={b.pfad}
				class={istAktiv(b.pfad) ? 'dock-active' : ''}
				aria-current={istAktiv(b.pfad) ? 'page' : undefined}>
				<Icon name={b.icon} groesse={21} />
				<span class="dock-label">{b.name}</span>
			</a>
		{/each}
	</nav>
</div>

<Toasts />
<PinDialog />
