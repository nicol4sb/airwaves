# Airwave

Airwave is a podcast PWA for the home network. Open `/nic` for Nic’s existing library or `/emma` for Emma’s separate library, which starts empty. The original `/` address still opens Nic’s library. Anyone on the LAN with access to the app can use either profile. Open **Podcasts → Add podcast** to subscribe.

Each profile has its own subscriptions, listening progress, audio downloads and device settings. Both can use the same Sonos rooms. To install a profile on a phone, open that profile’s URL before choosing **Add to Home Screen**.

## Local development on macOS

Install Node.js 24 LTS with npm. From this directory run

```sh
npm install
npm run dev
```

Open http://localhost:5173. Vite forwards API requests to Express on loopback port 4173. Local development requires no password. Use `SONOS_MODE=mock npm run dev` for an explicitly labeled simulated room. Live discovery is the default. Allow Node local-network access in macOS settings.

```sh
npm test
npm run check
npm run build
npm start
```

Stop the development server before running the production bundle on http://localhost:4173. The service worker is enabled in production builds. A real feed snapshot supplies initial metadata immediately. The first refresh imports the publisher’s current catalog. Removing the default subscription persists across restarts.

### Quick phone check on home Wi-Fi

Build once with `npm run build`. In the project’s `.env`, set `LAN_HOST` to this computer’s private IPv4 address and leave `APP_PASSWORD` blank. Restart with `npm run dev` or `npm start`. On the same trusted Wi-Fi, open `http://<LAN_HOST>:4173` in Safari without signing in. Port 4173 serves the built frontend and API together. Rebuild after frontend edits. Port 5173 remains available on the computer for hot reload. HTTP is for a local connectivity trial. Use the HTTPS setup below for installation and offline use.

## Raspberry Pi installation

1. Use a 64-bit Raspberry Pi OS installation with Docker Engine and the Compose plugin. Connect the Pi to the same LAN as the Sonos devices. Reserve the Pi’s IP address in DHCP.
2. Create a local DNS record, for example `airwave.home.arpa`, pointing to the Pi. Configure the iPhone to use that DNS resolver on Wi-Fi. Use this hostname consistently for installation and playback.
3. Copy the repository to the Pi. Run `cp .env.example .env`, set `APP_HOST` to the DNS name and leave `APP_PASSWORD` blank if you want password-free access on your private network. Use `chmod 600 .env`.
4. Run `docker compose up -d --build`, followed by `docker compose ps` and `docker compose logs --tail=80 app caddy`. The Node and Caddy base images have ARM64 variants. Both services use Linux host networking. Only Caddy serves the LAN. Express binds to loopback. Keep router port forwarding disabled for this deployment.
5. Export the **public root certificate** with `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./airwave-root.crt`. Transfer it to your iPhone over a trusted channel such as AirDrop. Install the downloaded profile in Settings → General → VPN & Device Management, then enable trust in Settings → General → About → Certificate Trust Settings. Keep the CA private key on the server.
6. Open `https://airwave.home.arpa/nic` or `https://airwave.home.arpa/emma` in Safari and choose Share → Add to Home Screen. Open the installed app online once and download an episode there. Keep using the same scheme, host and port. A different origin gets a different library on the phone.

Caddy owns ports 80 and 443. The internal CA and its keys persist in `caddy_data`. The `library` and `audio` volumes hold SQLite and downloaded files. For an external disk, mount it at boot and replace `audio:/audio` with a bind mount, for example `/srv/airwave/audio:/audio`. Grant UID 1000 write access to that directory. Stop the app before filesystem-level backups of the SQLite directory. Preserve all volumes across upgrades. Rebuild with `docker compose up -d --build`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| APP_PASSWORD | empty | Optional shared password for the whole app. Leave blank for password-free access |
| APP_HOST | airwave.home.arpa | Caddy’s stable HTTPS name |
| DATA_DIR / AUDIO_DIR | data / data/audio | SQLite directory and cache directory outside Compose |
| PORT | 4173 | Loopback API and bundled UI port |
| CACHE_MB | 2048 | Maximum retained audio size per profile in MiB |
| RETENTION_DAYS | 30 | Evict eligible older downloads |
| INITIAL_DOWNLOADS | 1 | Number cached when first subscribing |
| REFRESH_MINUTES | 60 | Refresh and retry interval |
| SONOS_MODE | local | Set to mock for development |
| SONOS_HOSTS | empty | Optional comma-separated private IPv4 speaker addresses if multicast is filtered |

Compose sets DATA_DIR to /data and AUDIO_DIR to /audio. If changing the production port, update Caddy and the app health check too. Nic uses the original SQLite file and audio directory. Emma’s files live under `profiles/emma/` within each directory. Phone download settings are per profile and per installation.

## Playback and offline use

- Play an episode or resume from the featured card. Tap the mini-player title for seek, skip and speed controls. Unplayed includes partly heard episodes until completion. Open a podcast and type in **Search episodes by title** to filter all its titles saved on this device. Episode search works offline once the library has synced, including titles whose audio you haven’t downloaded.
- The down-arrow saves audio to the current browser. A check mark confirms completion and can be tapped to delete the download. Library settings control automatic downloads of the latest unplayed episodes per podcast. Automatic cleanup preserves unfinished and manually downloaded episodes. Manual deletion suppresses subsequent automatic download of that episode.
- The installed app caches its shell, bundled art, metadata and downloaded audio. New remote artwork may be unavailable offline. IndexedDB stores listening progress until synchronization succeeds. Storage eviction and clearing website data can remove downloads. Check Downloaded before going offline. Leave the app open until the download finishes. A closed iOS PWA is not a reliable background downloader.
- The Pi downloads new episodes serially, retries failures during refresh, writes partial files separately and supports authenticated HTTP byte ranges. The server can evict older eligible files to make space, while preserving partially heard episodes. Allow space for one temporary download in addition to the retained cache.
- The Pi discovers Sonos rooms at startup and every minute using SSDP and Bonjour on each private IPv4 interface. Opening the device selector fetches the list from the Pi. If the Pi is unreachable, only this device is available. In the device selector, **Scan for speakers** waits for fresh discovery results. Each scan verifies the advertised devices and previously seen addresses against their Sonos UPnP descriptors, then lists reachable rooms by name. Select a room while listening to transfer playback. The adapter resolves the room’s coordinator and starts the selected episode at your current position. Sonos contacts the original enclosure URL, including publisher redirects. In Now Playing or the device selector, use the speaker volume buttons or slider to adjust the selected room. Supported keyboard volume keys change the room in steps of five percentage points while the app is in the foreground. The iPhone’s side buttons control the system audio output. Playback speed is a phone feature.
- Keep the Sonos speaker, router, DNS and internet connection powered for publisher streaming. Transfer back while the Pi is reachable. S1 firmware support for publisher TLS, redirects, audio encoding and seeking varies. Discovery alone does not verify a particular enclosure will play. Configure SONOS_HOSTS as a discovery fallback and check LAN multicast, wireless client isolation and VLAN routing if a speaker is missing.

## Architecture and security

`client/` contains React, IndexedDB synchronization and interchangeable browser/remote playback backends. `server/` owns SQLite, RSS ingestion, the download worker and authenticated API. `sonos/` exposes discover, start, control and status operations and has no database, filesystem-cache or feed dependencies. `shared/` contains API types. The frontend sends episode IDs to Express. Express loads the original publisher URLs from SQLite before passing them to the adapter. The adapter uses LAN SSDP, Bonjour, and SOAP and issues no grouping commands.

To move the main backend to a VPS, implement the SonosAdapter interface with an authenticated private-network client, keeping the current LAN implementation on the Pi. That transport is a future deployment step. Keep UDP discovery and TCP 1400 local. Use a VPN or authenticated tunnel between VPS and Pi. Moving the HTTPS origin requires rebuilding the phone’s local downloads.

When APP_PASSWORD is configured, Airwave uses an HttpOnly, Secure, SameSite session cookie after password login. With APP_PASSWORD blank, LAN users can access the app without signing in. Restarting the backend invalidates online sessions. Authenticated mutations require a custom request header and the server grants no cross-origin access. The offline library remains accessible on an unlocked phone. Only public HTTP(S) feed and server audio destinations are accepted. Each redirect gets fresh address validation and the socket connects to a validated IP. The local Sonos network path is separate.

## Acceptance checks on your hardware

1. On the iPhone 12 over trusted HTTPS, install Airwave. Play the latest 99% Invisible episode, pause, seek, change speed, lock the screen and try lock-screen controls. Reopen the PWA and check the saved position.
2. Download an episode and wait for its check mark. Put the phone in airplane mode, close and reopen the installed app, then play and seek within the downloaded episode. Reconnect and check progress synchronization.
3. Subscribe to a second public podcast RSS URL. Verify its artwork and episodes, refresh, then remove it. Verify removal survives a server restart.
4. Start an episode from a podcast’s search results. Select the CONNECT:AMP room. Verify sound, position, pause/resume, volume and transfer back. Repeat with a grouped room and then the One SL on its separate system. Check that neither system’s groups change.
5. Transfer an episode again. Take the phone offline and stop the Pi while leaving the LAN and internet up. Verify that the speaker keeps playing and that you can still search the podcast on the phone. Restart the Pi, select the room and verify status and transfer back.
6. Interrupt a download and disconnect a speaker during control. Verify a visible error, retry once reachable, and check there are no partial episodes listed as available.

Vitest covers real feed parsing, deduplication, subscription removal, progress ordering, IndexedDB outbox recovery, download failures/retries, SOAP escaping, coordinator routing and fault handling. Hardware discovery, speaker decoding and iOS background or offline playback require the device checks above.
