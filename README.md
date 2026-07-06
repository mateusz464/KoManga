# KoManga

Read manga from Tachiyomi/Mihon sources on your **Kobo e-reader**.

KoManga is a small self-hosted stack you run on your own machine. It browses and
searches manga sources, optimises pages for e-ink, and serves them to a
lightweight **KOReader plugin** on your Kobo, with offline reading capability.

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
git clone <this-repo> && cd KoManga
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

That's it! The server is running.

### 2. Install the Kobo plugin

Follow [`koreader-plugin/INSTALL.md`](koreader-plugin/INSTALL.md) to drop the
plugin into KOReader and point it at your server's URL and `AUTH_TOKEN`.

### 3. Read

Open the plugin on your Kobo, add a source, search for a series, and start
reading. Downloaded chapters stay readable with wifi off.

## Learn more

- [`RFC.md`](RFC.md) — how it all works, in detail.
- [`api/`](api/) — the server (Node/TypeScript).
- [`koreader-plugin/`](koreader-plugin/) — the Kobo client (Lua).
