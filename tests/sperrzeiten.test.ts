import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { zuhause } from './hilfe';

beforeEach(() => { zuhause(); vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date(2026,9,19,21,0)); });
afterEach(() => vi.useRealTimers());
const nacht = { name: 'Nacht', tage: [1,2,3,4,5,6,7], von: '20:00', bis: '06:00' };

it.each([false,true])('überlappende Fenster vereinigen Schutzoptionen unabhängig von ihrer Reihenfolge: %s', async umgekehrt => {
    const s = await import('../src/lib/server/sperre');
    const fenster = [{ ...nacht, name: 'Tasten', tasten: true, stumm: false }, { ...nacht, name: 'Stumm', tasten: false, stumm: true }];
    for (const f of umgekehrt ? fenster.reverse() : fenster) s.anlegen(f);
    expect(s.status()).toMatchObject({ gesperrt: true, tasten: true, stumm: true });
    expect(s.status().fenster).toHaveLength(2);
});

it('Schnellsperre wirkt unabhängig vom regulären Zeitplan und ändert dessen Schalter nicht', async () => {
    const s = await import('../src/lib/server/sperre'); s.setzeGlobal(false); s.anlegen(nacht); s.schnell(10);
    expect(s.status()).toMatchObject({ gesperrt: true, schnell: true, global: false });
    vi.advanceTimersByTime(10*60000);
    expect(s.status()).toMatchObject({ gesperrt: false, global: false });
});

it('reguläre Änderungen und der Zeitplanschalter erhalten die Freigabe, eine neue Schnellsperre beendet sie', async () => {
    const s = await import('../src/lib/server/sperre'); s.freigeben(30); const id = s.anlegen(nacht);
    s.aendern(id,{ name: 'Umbenannt' }); s.setzeGlobal(false); s.setzeGlobal(true);
    expect(s.status().freigabeBis).not.toBe(''); expect(s.status().gesperrt).toBe(false);
    s.schnell(10); expect(s.status().freigabeBis).toBe(''); expect(s.status().gesperrt).toBe(true);
});

it('Beginn ist eingeschlossen und das Ende über Mitternacht gehört zum ausgewählten Vortag', async () => {
    const s = await import('../src/lib/server/sperre'); s.anlegen({ ...nacht, tage: [1] });
    expect(s.status(new Date(2026,9,19,19,59)).gesperrt).toBe(false);
    expect(s.status(new Date(2026,9,19,20,0)).gesperrt).toBe(true);
    expect(s.status(new Date(2026,9,20,5,59)).gesperrt).toBe(true);
    expect(s.status(new Date(2026,9,20,6,0)).gesperrt).toBe(false);
    expect(s.status(new Date(2026,9,20,20,0)).gesperrt).toBe(false);
});

it('beim Ende eines Fensters bleiben die übrigen Schutzoptionen wirksam', async () => {
    const s = await import('../src/lib/server/sperre');
    s.anlegen({ ...nacht, name: 'Kurz', bis: '22:00', tasten: true, stumm: false });
    s.anlegen({ ...nacht, name: 'Lang', bis: '23:00', tasten: false, stumm: true });
    expect(s.status().fenster[0].name).toBe('Kurz');
    expect(s.status(new Date(2026,9,19,22,0))).toMatchObject({ gesperrt: true, tasten: false, stumm: true, name: 'Lang' });
});

it.each([{ von: '20:00', bis: '20:00' }, { von: '24:00', bis: '06:00' }, { von: '20:00', bis: '06:80' }, { tage: [] }])('ungültige Dauer oder Tagesauswahl wird vor dem Schreiben abgelehnt: %j', async ungueltig => {
    const s = await import('../src/lib/server/sperre');
    expect(() => s.anlegen({ ...nacht, ...ungueltig })).toThrow(); expect(s.fensterListe()).toHaveLength(0);
});

it('alte wirkungslose Fenster werden nicht als ganztägig umgedeutet und müssen beim Bearbeiten korrigiert werden', async () => {
    const speicher = await import('../src/lib/server/store');
    const id = speicher.insertSperre({ name: 'Alt', tage: '1', von: '20:00', bis: '20:00', aktiv: 1, tasten: 1, stumm: 1, einmal_bis: '' });
    const s = await import('../src/lib/server/sperre');
    expect(s.status().gesperrt).toBe(false); expect(() => s.aendern(id,{ aktiv: true })).toThrow('unterscheiden');
    s.aendern(id,{ bis: '23:00' }); expect(s.status().gesperrt).toBe(true);
});
