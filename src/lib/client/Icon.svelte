<script lang="ts">
	// Gezeichnete Symbole statt Zeichenvorrat: eine Strichstaerke, ein Raster.
	let { name, groesse = 22, klasse = '' }: { name: string; groesse?: number; klasse?: string } = $props();

	const pfade: Record<string, string> = {
		start: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
		sender:
			'M9 17V5l10-2v12 M9 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0 M19 15.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0',
		wecker: 'M6 9a6 6 0 1 1 12 0c0 4 1.4 5.4 2 6H4c.6-.6 2-2 2-6z M10 19a2 2 0 0 0 4 0',
		szenen: 'M12 3 3 8l9 5 9-5-9-5z M4 12.5 12 17l8-4.5',
		mehr: 'M12 6.5v.01 M12 12v.01 M12 17.5v.01',
		play: 'M8 5.5l11 6.5-11 6.5V5.5z',
		pause: 'M10 5v14 M14 5v14',
		stop: 'M7.5 7.5h9v9h-9z',
		zurueck: 'M6 5v14 M18 5.5 8.5 12 18 18.5V5.5z',
		weiter: 'M18 5v14 M6 5.5 15.5 12 6 18.5V5.5z',
		stumm: 'M11 5 6 9H3v6h3l5 4V5z M16 9.5l5 5 M21 9.5l-5 5',
		ton: 'M11 5 6 9H3v6h3l5 4V5z M16 8.5a5 5 0 0 1 0 7 M19 6a9 9 0 0 1 0 12',
		timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 9v4.5l3 2 M9 2.5h6',
		plus: 'M12 5v14 M5 12h14',
		loeschen: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
		aendern: 'M4 20h4L20 8l-4-4L4 16v4z M14.5 5.5l4 4',
		schliessen: 'M6 6l12 12 M18 6 6 18',
		erneut: 'M20 12a8 8 0 1 1-2.4-5.7 M20 3.5v4h-4',
		check: 'M5 13l4.5 4.5L19 7',
		ring: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
		schloss: 'M7 11V8a5 5 0 0 1 10 0v3 M5 11h14v10H5z M12 15v2.5',
		geraet: 'M6 3h12v18H6z M9 7h6 M12 17.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
		info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11.5v5 M12 7.8v.01',
		box: 'M4 8h16v12H4z M4 8l2-3.5h12L20 8 M9.5 12h5',
		zufall: 'M16 3h5v5 M4 20 21 3 M21 16v5h-5 M15 15l6 6 M4 4l5 5',
		wiederholen: 'M17 1l4 4-4 4 M3 11V9a4 4 0 0 1 4-4h14 M7 23l-4-4 4-4 M21 13v2a4 4 0 0 1-4 4H3',
		welle: 'M5 12a7 7 0 0 1 14 0 M8 12a4 4 0 0 1 8 0 M12 12v.01',
		weiterpfeil: 'M9 6l6 6-6 6'
	};
</script>

<svg
	viewBox="0 0 24 24"
	width={groesse}
	height={groesse}
	class={klasse}
	fill="none"
	stroke="currentColor"
	stroke-width="1.7"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false">
	<path d={pfade[name] ?? ''} />
</svg>
