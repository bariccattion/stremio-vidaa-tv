<p align="center">
  <img src="logo.png" alt="Stremio" width="120" />
</p>

<h1 align="center">Stremio for Hisense Projectors &amp; VIDAA TVs</h1>

<p align="center">
  Built because the official <strong>Stremio Lite</strong> on Hisense projectors is broken and feature-limited. A full Stremio experience that actually works on PX3-Pro, M2 Pro, C2, C2 Mini, and any VIDAA TV.
</p>

<p align="center">
  <a href="https://bariccattion.github.io/stremio-vidaa-tv/"><img src="https://img.shields.io/website?label=GitHub%20Pages&logo=github&up_message=online&down_message=offline&url=https%3A%2F%2Fbariccattion.github.io%2Fstremio-vidaa-tv%2F" alt="Pages status" /></a>
  <img src="https://img.shields.io/badge/build-v8-orange" alt="Build version" />
  <img src="https://img.shields.io/badge/core-stremio--core--web%200.64.1-purple" alt="Core version" />
  <img src="https://img.shields.io/badge/platform-VIDAA%20OS-green" alt="Platform" />
  <a href="https://github.com/NoobyGains/stremio-vidaa-tv/stargazers"><img src="https://img.shields.io/github/stars/NoobyGains/stremio-vidaa-tv?style=social" alt="GitHub Stars" /></a>
</p>

---

## Why this exists

If you own a **Hisense Laser projector** (PX3-Pro, PX1-Pro, PX1HE, M2 Pro, Smart Mini C2, Smart Mini C2 Pro, C2 Ultra), you already know the story:

- The official **Stremio Lite** in the VIDAA app store buffers forever after 30–40 seconds, crashes on updates, and has no community addons, no transcoding, and no streaming server support.
- Hisense has effectively abandoned Stremio on these devices. The native app store barely updates for projectors.
- Most "install Stremio on Hisense" guides only cover retail TVs and silently fail on projectors because the projector firmware has **extra install restrictions** retail TVs don't.

This project was originally built to get Stremio working on a **Hisense PX3-Pro Ultra Short Throw Triple Laser 4K Projector**. It grew because users of other projectors and VIDAA TVs asked for help, so everything is designed to work on both.

## What you get

- **Full Stremio**, not Lite — community addons (Torrentio, etc.), streaming server support, transcoding, external debrid services all work.
- **Modern stremio-core v5 WASM engine** (currently **0.64.1**, synced from Stremio's official releases) grafted onto the original Stremio Theater v1.9.2 TV frontend (built for D-pad navigation and 10-foot viewing distance — perfect for projectors).
- **Projector-first defaults** — no full-screen error overlays blocking your remote, large UI sizing, the bookmark (Method 1) as the reliable install path.
- **Every custom feature is a toggle** in Settings &gt; Vidaa TV so you can turn anything on or off per device.
- **Reverse-engineered VIDAA integration** for native player handoff, hardware codec detection, trusted-domain registration, and launcher installation.

## Requirements

- A **Hisense projector** running VIDAA OS, OR a **Hisense / Toshiba / Sharp / AKAI TV** running VIDAA OS.
- A **Stremio account** ([stremio.com](https://www.stremio.com/), free).
- **Real-Debrid** or similar debrid service (recommended — makes most streams play natively with no streaming server needed).

No streaming server required for most users. With Real-Debrid + Torrentio, streams are direct H.264/HEVC links your TV/projector plays natively.

## Installation

**Start with Method 1 (bookmark) — it works everywhere and takes 30 seconds.** If you want a permanent launcher icon, prefer Method 2 (Sidee): it registers the tile over the same channel the official Hisense phone app uses, so it keeps working on newer firmware where browser-based install APIs have been restricted. The one-click installer (Method 3) also works on many TVs thanks to its app-registry write, but needs a PC and a temporary DNS change.

### Method 1: Bookmark in the TV Browser (works on everything)

1. On your TV/projector, open the **Internet Browser** (Home &gt; Apps &gt; "Browser" or the globe icon — check **All Apps** if you don't see it, some firmware hides it by default).
2. Go to:
   ```
   https://bariccattion.github.io/stremio-vidaa-tv/
   ```
3. Bookmark the page. Open it from the bookmark any time you want to use Stremio.

That's it. The app caches itself via a Service Worker so it launches instantly after the first load.

### Method 2: Sidee — permanent launcher tile (recommended on newer firmware)

[Sidee](https://github.com/Empi9245/Sidee) installs web apps as permanent launcher tiles over the same local control channel the official Hisense phone app uses (SSDP discovery + PIN pairing, MQTT/TLS). Because it goes through the TV's own app-catalog mechanism, it keeps working on newer firmware where `Hisense_installApp` is silently dropped. No developer mode, no DNS changes.

1. Download Sidee from its [releases page](https://github.com/Empi9245/Sidee/releases) (Windows ZIP or macOS) and run it — no admin rights needed, nothing installs.
2. Its dashboard opens in your PC browser. Make sure the PC and TV are on the same network, then press **Find TV**.
3. Click **Request code** — a 4-digit PIN appears on the TV screen. Enter it in the dashboard and confirm.
4. Pick **Stremio**, optionally paste your streaming-server URL, and confirm. The tile persists across reboots — Sidee doesn't need to keep running.

**Installing this repo's build instead of the upstream one.** Sidee's built-in Stremio option installs the upstream `NoobyGains` deployment and has no custom-URL option. To install the build from this repository:

1. Clone Sidee and install its requirements:
   ```bash
   git clone https://github.com/Empi9245/Sidee.git
   cd Sidee
   pip install -r requirements.txt
   ```
2. Edit the `stremio` preset in `core/presets.py` to point at this deployment (keep `app_id` as `stremiodebug` — it overwrites any old Stremio tile instead of duplicating it):
   ```python
   "stremio": {
       "name": "Stremio",
       "app_id": "stremiodebug",
       "url": "https://bariccattion.github.io/stremio-vidaa-tv/?install_source=sidee",
       "image": "https://bariccattion.github.io/stremio-vidaa-tv/icon.png",
       ...
   }
   ```
3. Run `python sidee.py` and pair as described above.

Sidee's optional streaming-server field is appended to the URL as `&server=` — this app already understands it (see [Streaming Server](#streaming-server-optional)).

### Method 3: One-Click Installer (DNS-based, with app-registry write fallback)

Adds a permanent launcher icon. Requires a PC on the same network. The installer tries two paths, in order:

- **App registry write (preferred):** when the TV exposes `HiUtils_createRequest`, the installer reads `websdk/Appinfo.json` — the launcher's own web-app list — and writes the Stremio entry into it directly. This lands the icon even on firmware that accepts `Hisense_installApp`, reports success, and then never adds the entry (the silent drop). Requires a full TV restart afterward. If the registry can't be read, the installer never writes blind — it falls back to the legacy path.
- **Legacy API:** the classic `Hisense_installApp()` call, as before.

1. Download and run the installer:
   ```bash
   git clone https://github.com/NoobyGains/stremio-vidaa-tv.git
   cd stremio-vidaa-tv/installer
   python server.py
   ```
2. On your **TV**: go to **Settings &gt; Network &gt; DNS** and set it to the IP shown by the script.
3. On your **TV**: open the **Internet Browser** and go to `https://vidaahub.com`.
4. Press **Install Stremio**.
5. Revert DNS to automatic and fully restart your TV (unplug for 10 seconds if needed).
6. If Stremio appears in the launcher — great. If not, check the diagnostics panel on the installer page (it records which install path ran), and fall back to Method 1 or Method 2.

The installer only spoofs `vidaahub.com`, forwards normal DNS requests upstream, and serves the install UI/icons locally to avoid GitHub Pages lookups during installation.

### Method 4: Self-hosted

```bash
git clone https://github.com/NoobyGains/stremio-vidaa-tv.git
cd stremio-vidaa-tv
docker build -t stremio-vidaa .
docker run -d -p 8000:8000 stremio-vidaa
```

Then open `http://<your-pc-ip>:8000` on your TV.

## Streaming Server (optional)

**Most users don't need this.** With Real-Debrid, your TV plays streams directly. No server required.

You only need a streaming server if you:
- Stream raw torrents without a debrid service
- Play AV1 content (not supported on VIDAA hardware)
- Want automatic transcoding for codecs your TV can't handle

A streaming server is a separate program that runs on your network (PC, NAS, Raspberry Pi) and converts unsupported video formats to H.264 on the fly.

**Setup:**

```bash
docker run -d --name stremio-server -p 11470:11470 stremio/server
```

Or install [Stremio desktop](https://www.stremio.com/downloads) on a PC, which includes the server automatically.

**Connect it to the app** at **Settings > Server > Edit URL**: type the address (e.g. `http://192.168.1.50:11470`) and confirm — the address is saved for every future session, and the app pings it with a timeout to tell you whether it answered. Not sure of the address? Press **Auto-Detect** in the same dialog to sweep the local network for a running Stremio server (it only runs when you press it).

Shortcut: you can also add `?server=` to the URL once, and it is saved automatically:

```
https://bariccattion.github.io/stremio-vidaa-tv/?server=http://192.168.1.50:11470
```

Replace `192.168.1.50` with your server's IP.

**Server shows "Offline" but streaming works?** The status row reflects a one-shot check the app core makes against the server — it doesn't retry, so a single hiccup (or a TV browser blocking direct checks from an https page to an http server) can leave it stuck on "Offline" even though playback works. The app self-heals this within about a minute, and the row also honors the app's own periodic health check. For ground truth, press the **Green** remote key (outside the player): that overlay shows the live health probe. If it reports offline on a GitHub Pages (https) installation while streams play fine, your TV blocks cross-origin checks — install via the http installer for full server integration.

## Tested Codec Support (Hisense PX1HE / 100L5H)

Tested via live hardware scanning and real stream playback:

| Format | Status | Notes |
|---|---|---|
| H.264 (all profiles, up to 4K) | Plays | Native browser decode |
| HEVC/H.265 (Main, Main10, 4K) | Plays | Native browser decode |
| HEVC 10-bit | Plays | Tested with real content |
| Dolby Vision + HDR (MKV) | Plays | Tested at 4K. Native decode, no transcoding needed |
| Dolby Vision + HDR + Atmos (MKV) | Plays | Full DV with Atmos audio works |
| Dolby Vision (MP4 container) | Does not play | Browser crashes or hangs. Use MKV sources |
| VP8 / VP9 | Plays | Native browser decode |
| AV1 | Not supported | Requires streaming server for transcoding |
| Content above 4K (4320p, 8K) | Black screen | Exceeds hardware decode limit |
| AAC, AC-3, EAC-3, Opus, FLAC | Plays | All common audio formats supported |

DRM: Widevine, PlayReady, and ClearKey are all supported.

> Other VIDAA TV models may have different codec support. These results are from a PX1HE running VIDAA U06.29 with a MediaTek MT9900 chipset.

## Features

| Feature | Description |
|---|---|
| **Full addon support** | All community addons work, including Torrentio with Real-Debrid |
| **Dolby Vision playback** | DV+HDR streams in MKV play natively at 4K. Smart stall detection warns only on actual failure |
| **Server URL setup** | Native **Settings > Server > Edit URL** as a plain TV-friendly field: Auto-Detect sweeps the LAN for the server (manual only), Confirm pings the saved URL with a timeout, and the address persists for future sessions. `?server=` still works as a shortcut; changes sync to the WASM core |
| **VIDAA keyboard fix** | 3-layer fix for the VIDAA on-screen keyboard not triggering search |
| **Resolution indicator** | Shows current playback quality (4K/1080p/720p) in the player |
| **Splash screen** | Loading screen with progress bar while WASM initialises |
| **Error messages** | Codec-specific, actionable messages instead of generic "video not supported" |
| **One-click install** | Permanent launcher icon via the included installer (app-registry write with legacy fallback) or via Sidee |
| **Service Worker** | Caches the entire app for instant boot after first load |
| **720p zoom fix** | Auto-corrects viewport scaling on projectors and 720p-reporting TVs |
| **Watchdog** | Auto-recovers from UI freezes |

## Beyond Stremio Core

This build includes fixes and features that go above and beyond what standard stremio-core provides. These are all implemented as self-contained patches in the `index.html` patch layer.

### Crash & Stability Fixes

| Fix | Description |
|---|---|
| **Suppress F key crash** ([#10](https://github.com/NoobyGains/stremio-vidaa-tv/issues/10)) | Prevents the VIDAA browser from crashing when the F key (fullscreen) is pressed. Fullscreen is meaningless on a TV — the browser is always fullscreen. |
| **Exit button for TV** ([#6](https://github.com/NoobyGains/stremio-vidaa-tv/issues/6)) | Adds an "Exit Stremio" button to Settings. Wired to `Hisense_Exit()` on VIDAA devices for a clean app exit. |

### Playback Persistence

| Fix | Description |
|---|---|
| **Save playback speed & volume** ([#9](https://github.com/NoobyGains/stremio-vidaa-tv/issues/9)) | Remembers your preferred playback speed and volume across sessions via localStorage. Automatically restored on each video. |
| **Fix subtitle size on start** ([#8](https://github.com/NoobyGains/stremio-vidaa-tv/issues/8)) | Persists subtitle size preference and force-applies it when the player initialises, preventing the core from resetting it. |
| **Remember subtitle language** ([#7](https://github.com/NoobyGains/stremio-vidaa-tv/issues/7)) | Stores your selected subtitle language and auto-selects a matching track when a new video starts. Supports partial language matching (e.g. "en" matches "eng"). |

### Subtitle Enhancements

| Fix | Description |
|---|---|
| **Subtitle off/unload option** ([#11](https://github.com/NoobyGains/stremio-vidaa-tv/issues/11)) | Injects a "None/Off" option into the subtitle picker so you can disable subtitles entirely. Standard Stremio has no way to turn subtitles off once enabled. |
| **Full subtitle filenames** ([#14](https://github.com/NoobyGains/stremio-vidaa-tv/issues/14)) | Intercepts addon subtitle responses and caches full filenames. Patches the subtitle picker DOM to show descriptive names instead of truncated labels. |

### Native Player Integration

| Fix | Description |
|---|---|
| **Full title to native player** ([#12](https://github.com/NoobyGains/stremio-vidaa-tv/issues/12)) | Scrapes the title from the player DOM and detail pages, then passes it in the native VIDAA player handoff payload so the system player shows the correct title. |
| **Mark as watched after native handoff** ([#13](https://github.com/NoobyGains/stremio-vidaa-tv/issues/13)) | After launching the native player, estimates progress and dispatches a mark-as-watched action to stremio-core so your library stays in sync. |

### Performance

| Fix | Description |
|---|---|
| **Prefetch next episode** ([#15](https://github.com/NoobyGains/stremio-vidaa-tv/issues/15)) | When watching a series, automatically fires a background fetch for the next episode's stream URL to warm the streaming server cache and reduce load time. |

### Direct Torrent Streaming (Experimental) ([#16](https://github.com/NoobyGains/stremio-vidaa-tv/issues/16))

Streams magnet links from torrent addons directly in the browser via [WebTorrent](https://webtorrent.io) — no streaming server, no debrid. **Off by default**; enable it in Settings ▸ Torrent Streaming.

**Set honest expectations: this is a last-resort path, not a debrid replacement.** A browser can only discover torrent peers over WebRTC, and almost nothing seeds over WebRTC. **We measured 0/40 popular Torrentio torrents with any WebRTC-capable peers (Oct 2026).** Unless a torrent has a web seed (archive.org-style), playback simply cannot start. For reliable streaming, use Real-Debrid with Torrentio or run a [Stremio streaming server](#streaming-server-optional).

How it works in this build:

- **webtorrent 3.0.21, pinned and vendored** — `upstream/vendor/webtorrent/3.0.21/`, syntax-lowered to ES2017 so older TV browsers can parse it. Nothing is fetched from a CDN at play time (the old floating `webtorrent@latest` CDN load was unreliable and is gone).
- **Progressive streaming, not buffering** — playback goes through webtorrent's service-worker streaming server (`file.streamTo`), so the first frame starts long before the file finishes downloading. (Earlier builds used `getBlobURL()`, which buffered the *entire file into RAM* before playing.)
- **Trackers: synced from [ngosang/trackerslist](https://github.com/ngosang/trackerslist)**, the bot-checked public tracker repo — run `npm run sync-trackers` to refresh. Only that repo's `wss://` websocket list applies here: its other 80+ entries are udp/http announce, which browsers can't speak. Current set: `wss://tracker.webtorrent.dev`, `wss://open.ftorrent.com`, `wss://tracker.openwebtorrent.com` (the last one is known-flaky; the bot keeps it because it currently answers).
- **Honest failure story** — if zero peers connect within ~30 seconds, a dismissible message says the torrent isn't web-seeded and points at debrid / a streaming server, instead of an eternal "Connecting to peers…".

### Existing VIDAA-Specific Features

These were already in the build before the above patches:

- **VIDAA keyboard fix** — 3-layer interception for the VIDAA on-screen keyboard
- **Native VIDAA player handoff** — Yellow button opens current stream in the system player for full DV/HDR hardware decode
- **VIDAA API integration** — Trusted domain registration, device capability detection, real-time video state observers
- **One-click launcher install** — Registry write of `websdk/Appinfo.json` with the legacy `Hisense_installApp` call as fallback, in both the installer and the in-app banner
- **Channel Up/Down quick seek** — 60-second skip forward/back
- **720p viewport correction** — Auto-zoom fix for projectors and 720p-reporting TVs
- **Memory pressure monitoring** — Warns when JS heap usage exceeds 85%
- **Smart DV/HDR handling** — Detects stalled DV playback and offers native player, transcode, or alternative source

## Remote Control Shortcuts

| Button | Action |
|---|---|
| **Red** | Toggle resolution indicator (or Stream Stats overlay in player when enabled) |
| **Green** | Show/hide server health overlay (status, latency, version) |
| **Yellow** | Open current stream in native VIDAA player (full hardware DV/HDR decode) |
| **Blue** | Force transcode current stream |
| **Info / Display** | Show stream details (resolution, buffer, codec, VIDAA device info) |

## Troubleshooting

> **On projectors, Method 1 is the reliable path.** Most current Hisense projectors (PX3-Pro, M2 Pro, C2, C2 Mini, Smart Mini C2) silently drop `Hisense_installApp` even when it returns success — the launcher icon never appears no matter how many times you restart. The installer now writes the app registry directly to get around this, but the simplest answer remains: bookmark `bariccattion.github.io/stremio-vidaa-tv` in the TV's Internet Browser and open it from there. It works identically to the installed version.

| Problem | Solution |
|---|---|
| **Installer: "Install" button does nothing** | You need Developer Mode. Normally: Settings > System > About > press **1234** on the remote. **Your projector remote has no number buttons?** See "No number buttons on your remote" below. |
| **Installer says success but no launcher app appears** | The installer tries a direct app-registry write (`websdk/Appinfo.json`) first — make sure you fully restarted the TV (unplug 10s), not just standby, since registry installs only surface after a restart. Still nothing? Copy the diagnostics blob from the installer page into a GitHub issue, and use **Method 2** (Sidee) or **Method 1** (bookmark) in the meantime. |
| **Sidee can't find or pair with the TV** | PC and TV must be on the same network (no VPN, no guest Wi-Fi). If the PIN expires, just request a new code. More details in [Sidee's README](https://github.com/Empi9245/Sidee). |
| **No number buttons on your remote (projectors, M2/C2/PX3-Pro)** | Try in this order: (1) Install **RemoteNow** on your phone — its virtual numpad enters `1234` on the About screen; (2) Check **Settings > System > Developer Options** directly — some newer firmware has the toggle without needing `1234`; (3) Try the hidden key sequence: **Home ×3, Up ×2, Right, Left, Right, Left, Right**; (4) Plug in a USB keyboard and type `1234`. If none of that works, skip Developer Mode entirely — Sidee (Method 2) doesn't need it, and neither does the bookmark (Method 1). |
| **Can't find the browser on TV** | The Internet Browser may be hidden. Go to Home > Apps > All Apps and look for "Browser" or a globe icon. |
| **"Server Offline" in Settings** | Your streaming server must be running on a device on the same network. Test by visiting `http://<server-ip>:11470/heartbeat` in a browser. Most Real-Debrid users don't need a server at all. |
| **Black screen during playback** | Could be: DV content in MP4 container (use MKV sources instead), content above 4K resolution, or an unsupported codec. The app detects stalled playback and offers options. |
| **Playback stops after a few minutes** | Usually a server connection issue. If you don't use a streaming server, this shouldn't happen. If you do, check that the server URL is correct in Settings. |
| **Search keyboard doesn't work** | Check the version number in the bottom-right corner. If it doesn't show v8, clear the browser cache or add `?v=new` to the URL. |
| **App shows old version** | The service worker may be caching an old copy. Go to Settings > Clear Data, or clear the TV browser cache. |
| **720p UI is clipped** | The app auto-detects 720p viewports and applies zoom correction. If it's not working, your TV may report a non-standard viewport size. |

## How It Works

```
┌──────────────────────────────────────────┐
│  Stremio Theater v1.9.2 Frontend (UI)    │
│  upstream/theater-1.9.2 — 59 chunks:     │
│  home, discover, search, player,         │
│  settings, library, addons, video,       │
│  47 translations, assets (untouched)     │
├──────────────────────────────────────────┤
│  VIDAA Patch Layer (patches/)            │
│  42 ordered scripts inlined into         │
│  index.html at build + 3 surgical chunk  │
│  edits stored as data — server sync,     │
│  codec detection, VIDAA API, launcher,   │
│  remote keys, QoL toggles, diagnostics   │
├──────────────────────────────────────────┤
│  stremio-core-web 0.64.1 WASM engine     │
│  upstream/core-web — worker bundled from │
│  the official npm package                │
├──────────────────────────────────────────┤
│  Service Worker (generated sw.js)        │
│  Caches the full app shell for instant   │
│  TV boot                                │
├──────────────────────────────────────────┤
│  Build (scripts/build.mjs)               │
│  upstream/ + patches/ → app/, hashes     │
│  pinned in UPSTREAM.lock.json            │
├──────────────────────────────────────────┤
│  One-Click Installer (installer/)        │
│  DNS spoof + HTTPS server + auto-install │
└──────────────────────────────────────────┘
```

The patch layer sits between the original UI and the core engine. All patches are isolated in `patches/head/` as self-contained scripts (inlined into `index.html` at build time, in order), with three surgical edits to bundled chunks expressed as data in `patches/chunk-edits/` (error handling and transcoding hooks). The WASM binary and original UI chunks are untouched; every upstream file is verified by SHA-256 against `UPSTREAM.lock.json` on each build.

## Development & Syncing

The repo separates **replaceable Stremio artifacts** (`upstream/`, hash-locked) from **our VIDAA customizations** (`patches/`), assembled into the deployable site by `scripts/build.mjs`. To pick up a new stremio-core-web engine or fresh translations from Stremio:

```bash
node scripts/sync-core.mjs --version <x.y.z>   # engine from npm
node scripts/sync-translations.mjs             # translations from Stremio/stremio-translations
npm run build && npx playwright test           # rebuild + 117-test verification
```

See [docs/SYNC.md](docs/SYNC.md) for the full runbook, including how to bisect an engine version and how to add patches. Note: the compiled Theater v1.9.2 UI itself is an unpublished Stremio TV build — there is no newer public version of it to sync (the public Stremio/stremio-web repo is a different, mouse-first app).

## Under the Hood

This build is backed by reverse engineering of the VIDAA OS browser environment. Through live hardware scanning of a Hisense PX1HE, we mapped 110+ VIDAA JavaScript APIs, the full codec pipeline, HDR/Dolby Vision capabilities, DRM support, and the native app installation system.

Key discoveries:
- DV+HDR content in MKV containers plays natively at 4K in the VIDAA browser (no transcoding required)
- The `Hisense_installApp` API enables permanent launcher installation from trusted domains
- The web-app launcher list lives in `websdk/Appinfo.json` and can be updated directly via `HiUtils_createRequest` — the fallback used when firmware silently drops `Hisense_installApp` (via [weinzii/vidaa-edge](https://github.com/weinzii/vidaa-edge))
- Real-time video state observers (`Hisense_RegisterObserver`) provide live codec and HDR status
- The `omi_platform.sendPlatformMessage` interface accepts native player handoff commands

## Credits

- [Stremio](https://github.com/Stremio) — original Stremio web app, core, and sideload tooling
- [weinzii/vidaa-edge](https://github.com/weinzii/vidaa-edge) — VIDAA development toolkit used for API reverse engineering, including the `websdk/Appinfo.json` registry-write install technique
- [Empi9245/Sidee](https://github.com/Empi9245/Sidee) — PIN-paired launcher-tile installer over the official Hisense control channel
- [Stremio/stremio-hisense-install](https://github.com/Stremio/stremio-hisense-install) — original sideload script

## Community

- [r/Stremio](https://www.reddit.com/r/Stremio/) — Stremio community
- [r/Hisense](https://www.reddit.com/r/Hisense/) — Hisense TV community

## Support

If this project helped you get Stremio working on your TV, consider starring the repo or buying me a coffee.

<a href="https://buymeacoffee.com/noobygains"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="200" /></a>

## Disclaimer

This is an unofficial, community-maintained build for educational and self-hosting purposes only. All Stremio trademarks belong to Smart Code OOD. This project is not affiliated with or endorsed by Stremio.

## License

The original Stremio code is licensed under [GPLv2](https://github.com/user-attachments/files/19851539/LICENSE.md). Modifications in this repository follow the same license.
