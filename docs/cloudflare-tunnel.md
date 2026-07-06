# Cloudflare Tunnel setup (API-802)

The KoManga stack can be exposed to the internet through a Cloudflare Tunnel.
This is **opt-in**: the `cloudflared` connector lives behind the `tunnel` Compose
profile, so a plain `docker compose up -d` runs local-only (LAN) and needs no
Cloudflare account or token. Enable the tunnel with `docker compose --profile
tunnel up -d` (or `COMPOSE_PROFILES=tunnel`). When enabled, the connector (see
`docker-compose.yml`) dials *out* to Cloudflare's edge and proxies HTTPS requests
back to the API over the internal Docker network. The consequences, all required
by RFC §9:

- **No inbound ports** are opened on the home router — the connection is
  outbound-only, so the home IP stays hidden.
- **TLS is terminated at the Cloudflare edge**; clients always speak HTTPS to the
  public hostname.
- **Suwayomi is never publicly reachable** — the tunnel is configured to route
  the public hostname to `http://api:3000` and nothing else. Suwayomi has no
  published port and is not a tunnel ingress target.

This is a *remotely-managed* (token-based) tunnel: the public hostname → service
mapping lives in the Cloudflare Zero Trust dashboard, so there is no local
config file to maintain. The container only needs the connector token.

## Prerequisites

- A Cloudflare account with a domain (zone) added to it.
- The domain's DNS managed by Cloudflare (the tunnel creates the DNS record for
  you).

## One-time setup

1. **Create the tunnel.** In the Cloudflare dashboard go to
   **Zero Trust → Networks → Tunnels → Create a tunnel**, choose
   **Cloudflared** as the connector type, and give it a name (e.g. `komanga`).

2. **Copy the connector token.** On the "Install and run a connector" screen,
   copy the token — the long opaque string that appears after `--token` in the
   sample `cloudflared` command. (You do **not** run that sample command
   yourself; the `cloudflared` container does.)

3. **Store the token.** Put it in the root `.env` (next to
   `docker-compose.yml`), never in version control:

   ```
   CLOUDFLARE_TUNNEL_TOKEN=<the token you copied>
   AUTH_TOKEN=<your single-user API secret>
   ```

   See `.env.example`. Under the `tunnel` profile Compose fails fast at `up` if
   either is unset. (`AUTH_TOKEN` is always required; `CLOUDFLARE_TUNNEL_TOKEN`
   only matters when the `tunnel` profile is active.)

4. **Add a public hostname → API route.** Still in the tunnel's configuration,
   open **Public Hostnames → Add a public hostname**:

   - **Subdomain / Domain:** the hostname you want, e.g. `manga.example.com`.
   - **Service Type:** `HTTP`
   - **URL:** `api:3000`

   This is the only ingress rule. Cloudflare creates the `CNAME` DNS record
   automatically. Because the service is `api:3000` (resolved on the internal
   `komanga` Docker network) and Suwayomi is *not* added here, only the API is
   ever exposed.

5. **Bring up the stack with the tunnel profile.**

   ```sh
   docker compose --profile tunnel up -d
   ```

   The `tunnel` profile adds the `cloudflared` connector on top of the base
   `suwayomi` + `api` services. It waits for the `api` healthcheck, then
   registers the connector; the tunnel shows **Healthy** in the dashboard once
   connected. (Without `--profile tunnel`, `cloudflared` is never started and the
   stack runs local-only.)

## Verifying

- `https://manga.example.com/health` → `200` (public, no auth).
- `https://manga.example.com/api/sources` without a credential → `401`; with
  `Authorization: Bearer <AUTH_TOKEN>` → `200`. (Auth is enforced by the API,
  API-702.)
- Suwayomi is **not** reachable: there is no tunnel hostname for it and no
  published port. `http://<host>:4567` from outside the Docker network fails.
- The home router has **no** forwarded/inbound ports for this stack.

For a full end-to-end pass over the whole reading path through the tunnel
hostname (auth → search → page → download → progress), run the smoke test —
see `smoke-test.md` (`npm run smoke`).

## Optional: Cloudflare Access (extra auth gate)

The API already enforces single-user auth (API-702), but you can put Cloudflare
Access *in front* of the tunnel for defence in depth — an identity gate at the
edge before requests ever reach the connector:

1. **Zero Trust → Access → Applications → Add an application → Self-hosted.**
2. Set the application domain to the tunnel hostname (e.g.
   `manga.example.com`).
3. Add a policy (e.g. allow a specific email, or a one-time-PIN login).

Caveat: Access protects *browser* traffic via an interactive login. The Kobo
client and any programmatic clients would then also need to satisfy Access — use
a **service token** (Access → Service Auth) and send the
`CF-Access-Client-Id` / `CF-Access-Client-Secret` headers, or scope the Access
policy to `/` paths only while bypassing it for the API paths the device uses.
For a single user, the API's own Bearer auth is sufficient; Access is optional.
