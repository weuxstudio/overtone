export type Bereich = 'sender' | 'szenen' | 'weckzeiten' | 'sperrzeiten';
export type Vorschauzeile = {
    schluessel: string; art: Bereich; name: string;
    zustand: 'neu' | 'vorhanden' | 'geaendert' | 'geloescht' | 'konflikt' | 'ungeklaert' | 'ungueltig';
    text: string; ziele: Array<{ id: string; name: string }>;
};
export type Vorschau = { ok: true; vorschau: true; token: string; alt: boolean; eintraege: Vorschauzeile[] };
export type Importoptionen = { klang?: boolean; wiedergabeart?: boolean; zeitplan?: boolean; aktivieren?: boolean };
export type Importentscheidungen = Record<string, string>;
export type Einzelergebnis = { art: Bereich; name: string; zustand: 'uebernommen' | 'uebersprungen' | 'fehlgeschlagen' | 'ungeklaert'; text: string };
