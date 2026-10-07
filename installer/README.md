# Stremio VIDAA Installer

One-click installer for Stremio on Hisense VIDAA TVs. It spoofs only `vidaahub.com`, forwards all other DNS lookups upstream, and serves the installer UI plus icon assets locally so the TV can still reach GitHub Pages during install.

## Requirements

- **Python 3.6+** (no pip packages needed)
- **OpenSSL** CLI on your PATH (ships with most OS installs; on Windows use Git Bash or install OpenSSL separately)
- **Admin / root** privileges (the server binds to ports 53 and 443)
- PC and TV on the **same local network**

## Quick Start

```bash
# Clone the repo (or just download the installer folder)
git clone https://github.com/NoobyGains/stremio-vidaa-tv.git
cd stremio-vidaa-tv/installer

# Run the server (as admin / root)
sudo python server.py        # macOS / Linux
python server.py              # Windows (run terminal as Administrator)
```

The server will print your local IP and step-by-step instructions:

```
Stremio VIDAA Installer
========================================
Local IP: 192.168.1.109

Step 1: On your TV, go to Settings > Network > DNS
Step 2: Set DNS to: 192.168.1.109
Step 3: Open the TV browser and go to: https://vidaahub.com
Step 4: Click "Install Stremio"
Step 5: Revert DNS to automatic and restart TV
```

## What Happens

1. **Selective DNS spoof** -- The server resolves `vidaahub.com` to your PC and forwards other domains normally, so the TV can still reach external hosts like GitHub Pages.
2. **HTTPS server** -- Serves the installer page with a self-signed certificate. The TV browser will show a certificate warning; accept it to proceed.
3. **Install (two paths, tried in order)** --
   - **App registry write (preferred):** newer firmware accepts `Hisense_installApp()`, reports success, and then never adds the launcher entry. When the TV exposes `HiUtils_createRequest` (technique documented by [weinzii/vidaa-edge](https://github.com/weinzii/vidaa-edge)), the installer instead reads `websdk/Appinfo.json` -- the launcher's own web-app list -- appends/updates the Stremio entry, and writes it back directly. A full TV restart then shows Stremio at the end of the app list. If the registry cannot be read, the installer refuses to overwrite it (never a blind write) and falls back to the legacy path.
   - **Legacy API:** `Hisense_installApp()` (only available on the `vidaahub.com` domain) registers Stremio as a web app on the TV.
4. **Revert** -- After installation, set your TV DNS back to automatic and restart. Stremio will appear in your app list.

The diagnostics panel on the installer page records which path ran (`install.method`, `registryInstall`) -- paste that blob into a GitHub issue if the icon still does not appear.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot bind to port 53` | Run as admin/root, or stop any existing DNS service (e.g. `systemd-resolved` on Linux: `sudo systemctl stop systemd-resolved`) |
| `OpenSSL CLI not found` | Install OpenSSL or run from Git Bash on Windows |
| TV shows certificate error | This is expected with a self-signed cert -- accept/proceed past the warning |
| Install button does nothing | Make sure you are on a VIDAA TV and accessed via `https://vidaahub.com` (not the raw IP) |
| App does not appear after install | Restart the TV fully (not just sleep). The installer now writes the app registry (`websdk/Appinfo.json`) directly when the TV exposes `HiUtils_createRequest`, which lands the entry even on firmware that silently drops `Hisense_installApp()`. If the diagnostics blob shows the registry write failed or was unavailable, use [Sidee](https://github.com/Empi9245/Sidee) or the direct browser method instead. |

## Security Note

This server handles DNS for the TV while it is configured as the TV's resolver. Only run it for the few minutes needed to install, then shut it down and revert your TV's DNS to automatic.
