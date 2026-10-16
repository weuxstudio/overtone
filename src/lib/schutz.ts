export type Pruefstand = 'bestaetigt' | 'abweichend' | 'ungeprueft' | 'nicht_noetig';
export type Geraeteschutz = {
    zustand: Pruefstand; geprueft: string; fehler: string[];
    stopp: Pruefstand; lautstaerke: Pruefstand; stumm: Pruefstand;
    tasten: 'angenommen' | 'ausstehend' | 'nicht_noetig';
};
export type Sperrstatus = {
    gesperrt: boolean; bis: string; name: string; tasten: boolean; stumm: boolean;
    schnell: boolean; freigabeBis: string; global: boolean;
    fenster: Array<{ id: number; name: string; bis: string }>;
    geraet?: Geraeteschutz;
};
export function schutzText(status: Sperrstatus | undefined, erreichbar: boolean | null = null): string {
    const g = status?.geraet;
    if (!status?.gesperrt) return g?.fehler.length ? `Freigabe am Gerät ausstehend. ${g.fehler.join(' ')}` : 'Keine Sperre vorgesehen.';
    if (erreichbar === false) return 'Sperre vorgesehen. Lautsprecher nicht erreichbar; Schutz nicht bestätigt.';
    const frischePruefung = g?.geprueft && Date.now() - Date.parse(g.geprueft) < 15000;
    const text = !frischePruefung || g?.zustand === 'ungeprueft' ? 'Sperre vorgesehen. Gerätezustand noch nicht bestätigt.'
        : g?.zustand === 'bestaetigt' ? status.stumm ? 'Wiedergabestopp, Lautstärke null und Stummschaltung am Gerät geprüft.' : 'Wiedergabestopp am Gerät geprüft.'
        : 'Sperre vorgesehen. Gerätezustand weicht ab.';
    return `${text}${status.tasten ? g?.tasten === 'angenommen' ? ' Befehl zur Tastensperre angenommen.' : ' Befehl zur Tastensperre ausstehend.' : ''}${g?.fehler.length ? ` ${g.fehler.join(' ')}` : ''}`;
}
