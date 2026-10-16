# Overtone

A small self hosted remote for a Sonos speaker. No Sonos account, no cloud, no app.
Everything runs on your own machine and talks to the speaker over the local network.

Built for a household speaker that should be easy to use from a phone: stations,
alarms, scenes, sound settings, spoken announcements, sleep sounds and a child lock.

![Overtone player](docs/player.png)

## What it does

- **Stations** – keep a list of radio streams, start and stop them. Live title and
  cover are read from the stream itself (ICY metadata) and shown while playing.
- **Now playing** – player card with cover, title, artist, progress, shuffle and
  repeat. Works for streams, for announcements and for a Spotify Connect session.
- **Alarms** – the alarm list lives on the speaker, so it rings even without this app.
- **Scenes** – several actions, one button.
- **Sound and light** – bass, treble, loudness, play mode, crossfade, LED state.
- **Announcements and sounds** – type a text and the speaker reads it out (macOS
  `say`), or generate sleep sounds such as rain, sea, noise and night with `ffmpeg`.
- **Child lock** – combines overlapping schedules and independent one-off locks.
  Playback, volume and mute are checked on the device. Button commands are shown
  as accepted commands. The schedule requires a running service. PIN stored as scrypt hash.
- **Backup** – versioned JSON with stable entry origins, a restore preview and
  explicit choices for conflicts, settings and activation.

## Requirements

- macOS or Linux with Node 22.17 or newer (the built-in SQLite needs it; npm is
  set up with `engine-strict`, so an older Node refuses to install)
- a Sonos speaker in the same network
- `say` and `ffmpeg` only for announcements and generated sounds

## Install

```sh
git clone https://github.com/weuxstudio/overtone.git
cd overtone
npm install
npm run build
PORT=8770 HOST=0.0.0.0 ORIGIN=http://127.0.0.1:8770 node build/index.js
```

Then open `http://127.0.0.1:8770`.

Run the automated tests with `npm test`. They use temporary data directories
and a simulated device, so they never touch real runtime data or the speaker.

## Restore a backup

The backup section under More first previews the latest local backup or a selected
JSON file. Applying the preview preserves existing entries, local edits and recorded
deletions. Version 2 backups retain entry origins across multiple exports and
installations. Older backups remain supported through explicit matching or creation
choices. Unknown format versions are rejected.

New alarms and schedules remain disabled unless their saved activation is explicitly
selected. Sound, play mode and the regular schedule switch also require explicit
selection. An outdated preview must be refreshed before applying it.

Confirmed steps survive partial failures and service restarts. If a device may have
created an alarm but its reply was lost, its result remains unresolved. Inspect the
current device list and assign the existing alarm or explicitly confirm that it was
not created before trying again. Skipping an unresolved step keeps its unresolved
status visible. There is no automatic rollback across the speaker and local files.

## Child lock operation

The regular schedule switch controls recurring windows. A new one-off lock applies
independently, ends a temporary release and preserves the regular switch setting.
Changes to recurring windows and their switch preserve an ongoing temporary release.
Overlapping windows combine their requested button and mute protections. Equal start
and end times are invalid; existing such windows need correction.

The interface distinguishes intended protection, measured device state and an
accepted button-lock command. Failed or stale device checks invalidate confirmation.
The latest device check is shown on the child-lock page. The service uses its local
time zone; an overnight window continues from the selected previous weekday.

Keep the service running for timed protection and release. Device alarms continue
without it, while timed enforcement and release by Overtone do not. A periodic check
does not establish a guaranteed maximum reaction time.

## Configure the speaker

On first start the file `~/.overtone/config.json` is created. Fill in the address
and the identifier of your speaker:

```json
{
  "host": "192.168.1.50",
  "uuid": "RINCON_00000000000000000",
  "callbackHost": "192.168.1.10",
  "notifyPort": 8771,
  "serviceName": "Overtone"
}
```

- `host` – local address of the speaker, port 1400 is used for the UPnP calls
- `uuid` – speaker identifier, shown in the Sonos app under system information
- `callbackHost` – address of the machine running Overtone, needed so the speaker
  can send its events back. Leave empty to detect it.
- `notifyPort` – local port for those events

Data lives in `~/.overtone`: database with stations, scenes and settings, generated
audio under `~/.overtone/ton`, backups under `~/.overtone/sicherungen`.

Run one instance per installation. The service listens for events from the speaker
on `notifyPort` (8771 by default) and that port must stay free: when it is taken, a
start falls back to a spare port, the box keeps sending its events to the older
process and the display stops following the speaker. Give a second installation its
own `notifyPort`. Stop the service with `kill` (SIGTERM); it closes within a few
seconds.

The station list starts with three widely known public streams as examples. Replace
them in the app with whatever you listen to.

## Reach it from a phone

The service listens on `0.0.0.0`, so the local address works inside the network.
For access from outside, a private network such as Tailscale is the intended way:
expose port 8770 through it and open the resulting address on the phone.

## Access without a password

There is no login. Access is decided by the network the service is reachable from,
so keep it inside your own network or a private overlay network. Only the child
lock, which guards the speaker, asks for a PIN.

## Structure

```
src/lib/server/     device access, streams, alarms, scenes, lock, audio
src/lib/client/     shared state, dialogs, icons
src/routes/         pages and API endpoints
```

## Notes

Sonos, Spotify and Apple Music are trademarks of their owners. This project is not
affiliated with any of them. It speaks the local UPnP interface that the speakers
offer in the network.

## License

MIT
