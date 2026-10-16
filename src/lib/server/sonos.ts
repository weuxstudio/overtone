// Minimal SOAP client for Sonos devices on the local network.
// No account, no cloud, no third party library. Talks to port 1400.

export type SoapResult = {
	ok: boolean;
	errorCode?: number;
	xml: string;
	values: Record<string, string>;
};

const SERVICES: Record<string, { path: string; urn: string }> = {
	AVTransport: { path: '/MediaRenderer/AVTransport/Control', urn: 'urn:schemas-upnp-org:service:AVTransport:1' },
	RenderingControl: { path: '/MediaRenderer/RenderingControl/Control', urn: 'urn:schemas-upnp-org:service:RenderingControl:1' },
	GroupRenderingControl: { path: '/MediaRenderer/GroupRenderingControl/Control', urn: 'urn:schemas-upnp-org:service:GroupRenderingControl:1' },
	ContentDirectory: { path: '/MediaServer/ContentDirectory/Control', urn: 'urn:schemas-upnp-org:service:ContentDirectory:1' },
	ZoneGroupTopology: { path: '/ZoneGroupTopology/Control', urn: 'urn:schemas-upnp-org:service:ZoneGroupTopology:1' },
	AlarmClock: { path: '/AlarmClock/Control', urn: 'urn:schemas-upnp-org:service:AlarmClock:1' },
	DeviceProperties: { path: '/DeviceProperties/Control', urn: 'urn:schemas-upnp-org:service:DeviceProperties:1' },
	SystemProperties: { path: '/SystemProperties/Control', urn: 'urn:schemas-upnp-org:service:SystemProperties:1' },
	MusicServices: { path: '/MusicServices/Control', urn: 'urn:schemas-upnp-org:service:MusicServices:1' }
};

export function escapeXml(value: string): string {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

export function unescapeXml(value: string): string {
	return String(value)
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

function collectValues(xml: string): Record<string, string> {
	// Only leaf tags carry values. A container tag must never consume its own
	// children, otherwise nested values are swallowed.
	const out: Record<string, string> = {};
	const re = /<([A-Za-z0-9_:]+)(?:\s[^>]*)?>([^<]*)<\/\1>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml))) {
		const name = m[1].includes(':') ? m[1].split(':')[1] : m[1];
		if (name === 'Envelope' || name === 'Body' || name === 'Fault' || name === 'detail') continue;
		if (!(name in out)) out[name] = unescapeXml(m[2]);
	}
	return out;
}

export async function call(
	host: string,
	service: keyof typeof SERVICES | string,
	action: string,
	args: Record<string, string | number> = {},
	timeoutMs = 10000
): Promise<SoapResult> {
	const svc = SERVICES[service];
	if (!svc) throw new Error('Unbekannter Dienst: ' + service);
	const inner = Object.entries(args)
		.map(([k, v]) => `<${k}>${escapeXml(String(v))}</${k}>`)
		.join('');
	const envelope =
		'<?xml version="1.0" encoding="utf-8"?>' +
		'<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
		's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
		`<u:${action} xmlns:u="${svc.urn}">${inner}</u:${action}>` +
		'</s:Body></s:Envelope>';

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`http://${host}:1400${svc.path}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'text/xml; charset="utf-8"',
				SOAPACTION: `"${svc.urn}#${action}"`
			},
			body: envelope,
			signal: controller.signal
		});
		const xml = await res.text();
		const values = collectValues(xml);
		const errMatch = xml.match(/<errorCode>(\d+)<\/errorCode>/);
		return { ok: !errMatch && res.ok, errorCode: errMatch ? Number(errMatch[1]) : undefined, xml, values };
	} finally {
		clearTimeout(timer);
	}
}

export function didlForHttpAudio(url: string, title: string): string {
	return (
		'<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
		'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ' +
		'xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">' +
		'<item id="-1" parentID="-1" restricted="true">' +
		`<dc:title>${escapeXml(title)}</dc:title>` +
		'<upnp:class>object.item.audioItem.audioBroadcast</upnp:class>' +
		`<res protocolInfo="http-get:*:audio/mpeg:*">${escapeXml(url)}</res>` +
		'</item></DIDL-Lite>'
	);
}
