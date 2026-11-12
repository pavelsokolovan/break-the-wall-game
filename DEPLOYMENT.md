# Online Duel and GitHub Pages deployment

Repository: https://github.com/pavelsokolovan/break-the-wall-game

Stage 9 repository configuration is implemented and tested locally. **No Render service
has been provisioned and no hosted multiplayer URL has been assigned or verified.**
This workspace has no Render credential/account connection. Local commits do not push,
create services, configure repository variables, or publish Pages.

| Item | Current status |
| --- | --- |
| Backend service / HTTPS health / public WSS | Pending Render account setup |
| `VITE_MULTIPLAYER_URL` repository variable | Pending actual backend URL |
| Pages target | `https://pavelsokolovan.github.io/break-the-wall-game/` (target, not a deployment claim) |
| Repository implementation / local validation | See [Stage 9 specification](docs/ONLINE_DUEL_STAGE_09_SPEC.md) |
| Two phones / real network acceptance | Stage 10, after hosted backend and Pages work |

## 1. Publish the reviewed commits and pass checks

Push the committed changes to `main` when ready to release. The workflow
`.github/workflows/deploy.yml` runs syntax checks, all Solo/duel/server/client tests,
and the production build on pull requests and `main`. Pull requests cannot deploy Pages;
manual deployment also requires the `main` ref. Use branch protection to require the
`build` job before merging changes to `main`.

Pages builds receive the public repository variable `VITE_MULTIPLAYER_URL`. Leave it
unset until the backend is verified: Solo remains fully playable and Online Duel reports
unavailable. No production localhost fallback is used. Nonempty malformed or insecure
backend URLs fail the build instead of silently shipping a broken configuration.

## 2. Create exactly one Render Free service

Sign in at https://dashboard.render.com, connect the repository, and create a Blueprint
from the committed `render.yaml`. Confirm the preview contains **one Free web service**
and no databases, disks, workers or paid resources. Choose the region near the players
before creation; the blueprint omits region, so Render otherwise defaults to Oregon.

The configuration declares:

- Node 22 (package engines require 22.12+), one instance, `plan: free`.
- Build `npm ci`, start `npm run start:server`, bind `0.0.0.0` and Render's `PORT`.
- Health `/health`; production Origin `https://pavelsokolovan.github.io` without repo path.
- `MAX_ROOMS=20`, `MAX_SOCKETS=100`, `LOG_LEVEL=info`.
- `autoDeployTrigger: checksPass`: subsequent deploys wait for linked-branch CI checks.
  Verify this setting and the GitHub connection in Render after initial provisioning.
- Use Render's default shutdown allowance: Free services do not support configuring
  `maxShutdownDelaySeconds`. The application force-closes transports after one second
  and sends terminal interruption before stopping. Rooms are in memory.

Keep the compute plan Free. Free services sleep after 15 idle minutes and can take
about a minute to wake. Workspaces share 750 free instance hours each month; bandwidth
and build quotas also apply. With no payment method, over-quota behavior includes
suspension/build disablement; adding a payment method can enable supplementary charges.
Review account billing controls. This configuration creates no paid resources and adds
no artificial keep-awake requests. Sources checked 2026-11-12:
[Free limits](https://render.com/docs/free),
[Blueprint fields](https://render.com/docs/blueprint-spec),
[Node configuration](https://render.com/docs/node-version),
[WebSockets](https://render.com/docs/websocket).

## 3. Verify the real backend before configuring the frontend

Copy the actual public HTTPS URL from the new service's dashboard. Do not infer the
hostname from the blueprint's service name. Request `/health` with Origin
`https://pavelsokolovan.github.io`: require HTTP 200, `Cache-Control: no-store`, exact
`Access-Control-Allow-Origin`, and JSON `ok:true`, `v:1`, with `duel-session-v1` in
`features`. An unknown Origin must return 403. Health reveals no room or token data.

Use two WebSocket clients on the actual public `wss://<assigned-host>/ws` endpoint,
with the allowed Origin, to create/join a private room and complete a match/rematch.
A wrong Origin/path/version must fail. Verify clean shutdown/restart shows interruption,
never a fabricated result. Record observed URLs, region, date and results below.

## 4. Configure and publish GitHub Pages

1. Open repository Settings → Secrets and variables → Actions → Variables.
2. Add **repository variable** `VITE_MULTIPLAYER_URL` with the actual public
   `wss://<assigned-host>/ws` endpoint. It is public build configuration, not a secret.
   No credentials, query parameters, fragments or frontend repository path are allowed.
3. Open Settings → Pages and select GitHub Actions as the build source. Enable the
   official workflow actions under Settings → Actions if needed.
4. Run “Deploy game to GitHub Pages” on `main`, or push a reviewed change to `main`.
   Updating the variable alone does not trigger a build. The workflow preserves Vite's
   `/break-the-wall-game/` base path and uses GitHub's short-lived Pages token.
5. Open the actual deployed Pages URL in two independent browser sessions. Verify
   Solo before network access, explicit Online create/join, invitations, a complete
   match/result/rematch, history, reconnect and return to Solo with saves preserved.
6. After idle sleep, verify Waking server, Cancel, Retry and successful play. No request
   should be made merely by loading Solo or selecting Online without creating/joining.

Initial deployment order is backend → health/WSS verification → frontend variable → Pages
→ two-client hosted acceptance. Later frontend/backend deploys are not atomic. Health
version/session capability checks reject an incompatible backend visibly before any
room request; WebSocket messages retain protocol v1 checks. Stage 9-compatible builds
use additive optional fields. Bump capability/version deliberately for future breaking
changes and deploy the compatible backend first. Earlier unhosted development previews
are not a supported production release pair.

## Proxy identity and operational controls

By default the server rate-limits using the transport IP and ignores forwarded headers.
Render's ingress may aggregate multiple players behind an edge address. This is safe
against forged IPs but can share the five-create/join-attempts-per-minute budget between
users. Do not solve this by trusting all forwarding headers.

`TRUSTED_PROXY_CIDRS` accepts an explicit comma-separated IPv4/IPv6 CIDR list. Only set
it after verifying the actual direct ingress addresses, header append/sanitize behavior,
and that clients cannot bypass that ingress. The resolver walks X-Forwarded-For from
the trusted peer right-to-left; malformed/untrusted chains fall back to the peer.
The blueprint deliberately leaves this empty: no unverified Render proxy ranges or
blanket hop count are assumed. Revisit limits using hosted measurements before release.

`LOG_LEVEL=info` emits JSON operational lifecycle metadata; `silent` disables it. Logs
exclude resume tokens, headers, payload streams and client input. `/health` and WSS use
the same exact Origin allowlist. No CORS credentials are needed. Server restarts/deploys
lose in-memory rooms; there is no persistent reconnect guarantee across restarts.

## Local validation and rollback

```sh
npm ci
npm run check
npm test
npm run build -- --base=/break-the-wall-game/
npm run test:browser
```

For local two-client play use `npm run start:server` and `npm run dev`; `.env.example`
documents local configuration. The optional Chromium smoke uses local Vite/HTTP/WSS
fixtures, including simulated cold-start HTML, cancellation, retry, gameplay and recovery.
It is not proof of Render deployment or physical-phone behavior.

To disable online availability while retaining Solo, remove the repository variable and
rerun the Pages workflow. Roll back the server/frontend to a compatible reviewed pair;
a server redeploy interrupts active matches. Never roll back by enabling a paid plan.

## Hosted acceptance record (complete after account setup)

- Actual backend HTTPS and WSS URLs: **pending**.
- Region / Render Free plan / account quota settings: **pending**.
- Health/CORS/WSS from the production Pages origin: **pending**.
- Actual Pages deployment and two-client match/rematch/reconnect/cold start: **pending**.
- Proxy ingress identity verification and measured limits: **pending**.
- Stage 10 physical phones, Wi-Fi/mobile networks and release metrics: **pending**.
