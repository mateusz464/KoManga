# KoManga

Read manga from Tachiyomi/Mihon sources on your **Kobo e-reader**.

KoManga is a small self-hosted stack you run on your own machine. It browses and
searches manga sources, optimises pages for e-ink, and serves them to a
lightweight **KOReader plugin** on your Kobo, with offline reading capability.

KoManga does not provide, host, or endorse manga sources. You choose and install
your own Tachiyomi/Mihon-compatible source extensions in Suwayomi.

## What you need

- A machine to run the server on.
- [Docker](https://docs.docker.com/get-docker/).
- A Kobo running [KOReader](https://koreader.rocks/).
- *(Optional)* A free [Cloudflare](https://www.cloudflare.com/) account. Only
  if you want to reach your server from outside your home network. On the same
  LAN as your server, you don't need it.

## Getting started

### 1. Run the server

```sh
git clone https://github.com/mateusz464/KoManga.git
cd KoManga
cp .env.example .env
```

Edit `.env` and set two secrets:

- **`AUTH_TOKEN`** — a long random password of your choice. Your Kobo sends this
  on every request, so nobody else can use your server.
- **`CLOUDFLARE_TUNNEL_TOKEN`** — *(optional)* gives your server a public
  `https://…` address without opening any ports on your router, so you can read
  away from home. Leave it blank to run local-only on your LAN. See
  [`docs/cloudflare-tunnel.md`](docs/cloudflare-tunnel.md) for the one-time setup.

Then start everything. **Local-only** (on your LAN, no Cloudflare account or
token needed):

```sh
docker compose up -d
```

Or, to also expose your server through the Cloudflare Tunnel (once you've set
`CLOUDFLARE_TUNNEL_TOKEN`), add the `tunnel` profile:

```sh
docker compose --profile tunnel up -d
```

The server is now running. Next, add the sources you want KoManga to browse.

### 2. Add sources

KoManga does not include any manga sources by default. To choose which sites you
can browse, install Tachiyomi/Mihon source extensions in Suwayomi. This is a
one-time setup step done in **Suwayomi's WebUI**, not on the Kobo.

After you install extensions, KoManga detects them automatically and they appear
in the Kobo plugin. No API or plugin restart is needed.

**Open the Suwayomi WebUI.** KoManga does not publish Suwayomi directly to the
internet by default, so use the option that matches your setup:

- **Remote (Cloudflare Tunnel):** open the Suwayomi admin hostname you set up
  (e.g. `https://suwayomi.example.com`) and sign in through the Cloudflare
  Access challenge. See [`docs/cloudflare-tunnel.md`](docs/cloudflare-tunnel.md)
  for adding that hostname and its owner-only Access policy.
- **Local-only (LAN):** the stack publishes no Suwayomi host port by default.
  To reach the WebUI on your server for local maintenance, add a git-ignored
  `docker-compose.override.yml` next to `docker-compose.yml`:

  ```yaml
  services:
    suwayomi:
      ports:
        - "127.0.0.1:4567:4567"
  ```

  then `docker compose up -d` and open `http://127.0.0.1:4567` on the server.

**Then, in the WebUI:**

1. **Add an extension repository.** Recent Suwayomi versions do not include a
   default extension repository. Under **Settings → Browse / Extension
   repositories**, add the URL of the extension repository you want to use.
   KoManga does not host, bundle, or endorse source extensions.
2. **Install the source extension(s)** you want from the **Extensions** tab
   (search by site name, then Install).
3. **Configure or log in where required.** Some sources need a login or a
   setting (e.g. preferred language) before they return results — do that in the
   source's entry under **Sources / Extensions**.

Your sources now appear in the Kobo plugin.

### 3. Install the Kobo plugin

Follow [`koreader-plugin/INSTALL.md`](koreader-plugin/INSTALL.md) to drop the
plugin into KOReader and point it at your server's URL and `AUTH_TOKEN`.

### 4. Read

Open the plugin on your Kobo, pick a source, search for a series, and start
reading. Downloaded chapters stay readable with Wi-Fi off.

## Learn more

- [`RFC.md`](RFC.md) — how it all works, in detail.
- [`api/`](api/) — the server (Node/TypeScript).
- [`koreader-plugin/`](koreader-plugin/) — the Kobo client (Lua).
