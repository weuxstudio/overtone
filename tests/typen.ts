// Typen für die Tests: nur die Ausschnitte, die geprüft werden.
export type Rufen = {
	host: string;
	service: string;
	action: string;
	args: Record<string, string | number>;
};

export type AlarmZeile = {
	id: number;
	time: string;
	duration: string;
	recurrence: string;
	enabled: number;
	station_id: string | null;
	volume: number;
	label: string | null;
};

export type SzeneZeile = {
	id: number;
	name: string;
	station_id: string | null;
	play_mode: string | null;
};

export type StoreModul = {
	alarmRows(): AlarmZeile[];
	sceneRows(): SzeneZeile[];
	sperrRows(): Array<{ id: number; name: string; one_aktiv?: number; aktiv: number }>;
};
