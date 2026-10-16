import { json } from '@sveltejs/kit';
import { alarmStoerung, createAlarm, deleteAlarm, listAlarms, setAlarmEnabled, updateAlarm, RECURRENCE } from '#lib/server/alarms';
import { loadStations } from '#lib/server/overtone';

export async function GET(): Promise<Response> {
	const alarms = await listAlarms();
	return json({ alarms, recurrence: RECURRENCE, stations: loadStations(), stoerung: alarmStoerung() });
}

export async function POST({ request }: { request: Request }): Promise<Response> {
	const body = await request.json().catch(() => ({}));
	const action = String(body.action ?? '');
	let result: { ok: boolean; message?: string } = { ok: false, message: 'unbekannte Aktion' };
	switch (action) {
		case 'create':
			result = await createAlarm({
				time: String(body.time ?? ''),
				recurrence: body.recurrence,
				volume: body.volume,
				stationId: body.stationId,
				label: body.label
			});
			break;
		case 'update':
			result = await updateAlarm(Number(body.id), {
				time: body.time,
				recurrence: body.recurrence,
				volume: body.volume,
				stationId: body.stationId
			});
			break;
		case 'enable':
			result = await setAlarmEnabled(Number(body.id), true);
			break;
		case 'disable':
			result = await setAlarmEnabled(Number(body.id), false);
			break;
		case 'delete':
			result = await deleteAlarm(Number(body.id));
			break;
	}
	const alarms = await listAlarms();
	return json({ ...result, alarms }, { status: result.ok ? 200 : 502 });
}
