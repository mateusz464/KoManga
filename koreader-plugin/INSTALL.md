# Installing the KoManga KOReader plugin

This guide gets the **KoManga** plugin running inside KOReader on a Kobo and
pointed at your KoManga API. It covers a first install, updates, and
configuration.

> **You need two things:** a running **KoManga API** (the server that does the
> scraping and image processing) and **KOReader** on your Kobo. The plugin is a
> thin client — it does nothing without the API. Set up the API first (below),
> then install the plugin.

---

## 1. Stand up the KoManga API

The plugin talks to your own KoManga server over HTTPS. If you already have the
API running and know its URL + credential, skip to step 2.

The whole stack (Suwayomi source engine + API + Cloudflare Tunnel) runs from the
repo's root `docker-compose.yml`:

1. **Install Docker** (Docker Desktop, Colima, or Docker Engine).
2. **Create `.env`** at the repo root from `.env.example` / `api/.env.example`
   and set:
   - `AUTH_TOKEN` — a secret you choose. This is the single **credential** the
     plugin sends on every request. Make it long and random.
   - `CLOUDFLARE_TUNNEL_TOKEN` — the connector token from Cloudflare Zero Trust.
     See **`docs/cloudflare-tunnel.md`** for the one-time tunnel setup (this is
     what gives you a public `https://…` hostname for your API).
3. **Start it:** `docker compose up -d` from the repo root.

After this you have:

- **Server URL** — your Cloudflare Tunnel hostname, e.g.
  `https://komanga.example.com`. This is what you enter in the plugin.
- **Credential** — the `AUTH_TOKEN` value you set.

> For local testing you can point the plugin at `http://<mac-ip>:3000` on your
> LAN instead of the tunnel, but normal use goes through the HTTPS tunnel so it
> works off your home network.

---

## 2. Install KOReader on the Kobo

If KOReader is already installed and launchable, skip to step 3.

Follow the runbook in **`docs/koreader.md` → "On-device runbook"**. In short:

1. Connect the Kobo by USB (it mounts as **`KOBOeReader`**).
2. Extract the latest Kobo build of KOReader
   (<https://github.com/koreader/koreader/releases>, asset
   `koreader-kobo-*.zip`) to the **root** of `KOBOeReader`.
3. Install **KFMon** (<https://github.com/NiLuJe/kfmon/releases>) to the root so
   KOReader gets a one-tap tile on the Kobo home screen.
4. Eject, unplug, let Nickel re-import, then open the KOReader tile.

> **Kobo library clutter (one-time fix).** Newer Kobo firmware imports KOReader's
> UI icons as junk "books". Apply the `ExcludeSyncFolders` fix documented in
> `docs/koreader.md` → *"Gotcha: KOReader's icon SVGs imported into the Nickel
> library"* to stop it.

---

## 3. Install the plugin

The plugin is just a folder of Lua files — installing it is a copy, no build step
and no scripting, so it works the same on Windows, macOS, and Linux.

1. **Download** `komanga.koplugin-<version>.zip` from the project's releases.
2. **Extract** it. You get a folder named `komanga.koplugin`.
3. **Connect the Kobo by USB** and copy that whole `komanga.koplugin` folder into:

   ```
   KOBOeReader/.adds/koreader/plugins/
   ```

   so you end up with
   `KOBOeReader/.adds/koreader/plugins/komanga.koplugin/main.lua`.
   (`.adds` is a hidden folder — enable "show hidden files" if you don't see it.)
4. **Eject and unplug** the Kobo.
5. **Restart KOReader** (top menu → the gear/exit icon → *Restart*). KOReader
   only reads plugins at startup, so a restart is required for it to load.

You should now see a **KoManga** entry in KOReader's main menu.

---

## 4. Configure the plugin

Open the KOReader main menu → **KoManga**:

1. **Set server URL** — enter your API's base URL from step 1
   (e.g. `https://komanga.example.com`).
2. **Set credential** — enter the `AUTH_TOKEN` you set on the server.

Both are saved on the device and **persist across restarts and plugin updates**
(they live in KOReader's settings, not in the plugin folder). If you skip setting
the credential, the first request will prompt you for it automatically.

Then use **KoManga → Browse** to search sources, or **Library** for what you
follow and your downloaded chapters.

---

## 5. Update the plugin

Updating is the same copy, over the top of the old install:

1. Download the newer `komanga.koplugin-<version>.zip` and extract it.
2. Connect the Kobo and **replace** the existing
   `.adds/koreader/plugins/komanga.koplugin` folder with the new one (delete the
   old folder first, or let your OS overwrite it).
3. Eject, unplug, and **restart KOReader**.

Your **server URL and credential survive the update** — they're stored in
KOReader's settings directory, not inside the plugin folder, so overwriting the
folder never wipes them.

---

## 6. Uninstall

Delete `.adds/koreader/plugins/komanga.koplugin` from the Kobo over USB and
restart KOReader. (Your saved settings are harmless leftovers; remove
`koreader/settings/komanga.lua` too if you want them gone.)

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| No **KoManga** entry in the menu | The folder is in the wrong place or KOReader wasn't restarted. Confirm `.adds/koreader/plugins/komanga.koplugin/main.lua` exists, then restart KOReader. |
| "Not authorised" / repeated credential prompt | Wrong credential. Re-enter it under **KoManga → Set credential**; it must match the server's `AUTH_TOKEN`. |
| "Network error — is Wi-Fi on?" | Enable Wi-Fi (the plugin will offer to). Also check the **server URL** is reachable and correct under **KoManga → Set server URL**. |
| Nothing loads at all | Verify the API is up: open the server URL's `…/health` in a browser — it should return OK. |

> **For contributors:** `scripts/deploy.sh` (dev-only, macOS) and the emulator
> loop are documented in `docs/koreader.md`; `scripts/package.sh` builds the
> release zip described here. End users only need this document.
