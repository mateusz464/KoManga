# Cloudflare Tunnel setup (API-802, API-811)

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
- **AniList account linking uses the same API hostname**; register
  `https://<api-hostname>/api/tracker/anilist/callback` in AniList and keep the
  tunnel running while scanning the QR link. No separate callback hostname is
  needed.
- **Suwayomi is never reachable without an identity gate** — Kobo/content
  traffic uses only the API hostname. The Suwayomi admin WebUI may have a
  separate tunnel hostname only when a Cloudflare Access application already
  protects that hostname for the owner identity.

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
   ANILIST_CLIENT_ID=<your AniList OAuth client id>
   ANILIST_CLIENT_SECRET=<your AniList OAuth client secret>
   ANILIST_REDIRECT_URI=https://manga.example.com/api/tracker/anilist/callback
   ```

   See `.env.example`. `AUTH_TOKEN` and the AniList variables are required by
   the API service. `CLOUDFLARE_TUNNEL_TOKEN` is required only when the `tunnel`
   profile is active.

4. **Add a public hostname → API route.** Still in the tunnel's configuration,
   open **Public Hostnames → Add a public hostname**:

   - **Subdomain / Domain:** the hostname you want, e.g. `manga.example.com`.
   - **Service Type:** `HTTP`
   - **URL:** `api:3000`

   Cloudflare creates the `CNAME` DNS record automatically. Because the service
   is `api:3000` (resolved on the internal `komanga` Docker network), Kobo
   clients still only see the API's REST surface. The AniList OAuth callback is
   just a path on this same hostname:
   `https://manga.example.com/api/tracker/anilist/callback`.

5. **Create the Suwayomi WebUI Access policy before adding its route.** This is
   mandatory because Suwayomi's WebUI has no authentication of its own. See
   [Suwayomi admin WebUI Access policy](#suwayomi-admin-webui-access-policy-api-811)
   below. Do not add or announce the Suwayomi WebUI public hostname until that
   policy passes its verification checklist.

6. **Bring up the stack with the tunnel profile.**

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
- Suwayomi is **not reachable by the Kobo client** and has no published host
  port. `http://<host>:4567` from outside the Docker network fails.
- If a Suwayomi WebUI hostname exists, an unauthenticated request to that
  hostname must show a Cloudflare Access challenge or denial, never the raw
  Suwayomi WebUI. See the API-811 verification checklist below.
- The home router has **no** forwarded/inbound ports for this stack.

For a full end-to-end pass over the whole reading path through the tunnel
hostname (auth → search → page → download → progress), run the smoke test —
see `smoke-test.md` (`npm run smoke`).

## Suwayomi admin WebUI Access policy (API-811)

The Suwayomi admin WebUI is the place to install and manage Tachiyomi/Mihon
source extensions (the source-adding workflow itself is in the README's
[Adding sources](../README.md#2-add-sources) section). It is also a fully open
admin surface unless Cloudflare Access protects it, so KoManga treats Access as
mandatory for this hostname.

Use a separate hostname from the Kobo/API endpoint, for example:

- API: `manga.example.com` → `http://api:3000`
- Suwayomi WebUI: `suwayomi.example.com` → `http://suwayomi:4567`

Create the Access application before adding the Suwayomi public hostname route:

1. In Cloudflare Zero Trust, open **Access → Applications → Add an application →
   Self-hosted**.
2. Name it clearly, for example `KoManga Suwayomi WebUI`.
3. Set the application domain to the future Suwayomi WebUI hostname, for example
   `suwayomi.example.com`. Do not reuse the API hostname.
4. Set the session duration deliberately. The recommended default for this admin
   surface is one day: short enough to limit stale browser sessions, long enough
   that routine source maintenance is not painful.
5. Add a single **Allow** policy for the owner identity only:
   - Include rule: `Emails` equals the owner's email address; or
   - Include rule: the owner's SSO identity/group, if the Cloudflare account is
     already wired to an identity provider.
6. Leave service tokens unset. The WebUI is for browser administration only; no
   Kobo/plugin/API automation should need to call it. If automation is ever
   added, create a dedicated scoped service token in a later ticket instead of
   reusing the owner browser policy.
7. Save the application and policy.

Only after the Access application exists, API-810 may add the matching tunnel
public hostname:

- **Subdomain / Domain:** the Suwayomi WebUI hostname, e.g.
  `suwayomi.example.com`
- **Service Type:** `HTTP`
- **URL:** `suwayomi:4567`

The route and Access application must match the same hostname. A mismatch means
Cloudflare may route traffic to Suwayomi without applying the identity gate.

### API-811 verification checklist

Run this checklist before considering the Suwayomi route live:

- In a private/incognito browser session, open the Suwayomi WebUI hostname. The
  first screen must be a Cloudflare Access login/challenge or denial, not the
  Suwayomi WebUI.
- From a terminal, request the hostname without Access credentials:

  ```sh
  curl -i https://suwayomi.example.com/
  ```

  The response must be a Cloudflare Access challenge/redirect or denial. It must
  not contain Suwayomi/Tachidesk page content.
- Authenticate as the owner identity. The browser should reach the Suwayomi
  WebUI after Cloudflare Access succeeds.
- Try a non-owner identity, or remove the owner from the policy temporarily and
  retry. Access must deny the request.
- Confirm the Mac Mini/router still has no inbound port forwarding and
  `docker-compose.yml` still publishes no Suwayomi host port by default.

If any check fails, remove the Suwayomi public hostname route immediately and
fix the Access application before re-adding it.

## Optional: Cloudflare Access for the API

The API already enforces single-user Bearer auth (API-702), so Cloudflare Access
is optional for the API hostname. If you add Access in front of the API, remember
that the KOReader plugin and smoke tests are programmatic clients: they would
need an Access service token (`CF-Access-Client-Id` /
`CF-Access-Client-Secret`) or an Access bypass rule for the API paths they use.
