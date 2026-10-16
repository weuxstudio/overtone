import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			'#lib': fileURLToPath(new URL('./src/lib', import.meta.url))
		}
	},
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		// Alle Testdateien der Reihe nach, damit die simulierten Umgebungen
		// ($HOME) sich nicht überlappen.
		fileParallelism: false,
		// Die Tests verwenden temporäre Dateien und Datenbanken und sprechen
		// produktive Laufzeitdaten wie ~/.overtone nie an.
		testTimeout: 20000
	}
});
