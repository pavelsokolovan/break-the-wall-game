# Stage 9 specification: free hosting and release configuration

Status: repository implementation complete locally. Render provisioning and hosted
acceptance are pending account setup; Stage 10 device acceptance has not started.

## Permanent modes and scope

Keep Solo and Online Duel as permanent separate choices. Solo requires no backend,
keeps its campaign, saves and explicit resume behavior, and starts no network activity.
Prepare Render Free backend and Pages release, bounded cold starts, operational limits,
shutdown, compatibility and CI. Do not invent a live hostname or claim deployment without
observed service health and two-client acceptance. No paid services, database or disk.

## Deployment and configuration

- Root render.yaml: one Node web service, plan free, main branch, npm ci build,
  npm run start:server, /health, NODE_VERSION=22, NODE_ENV=production, exact Pages
  ALLOWED_ORIGINS, MAX_ROOMS=20, MAX_SOCKETS=100, LOG_LEVEL=info. Bind 0.0.0.0 and
  platform PORT. Use autoDeployTrigger=checksPass to wait for linked-branch CI.
- Node engines require 22.12+. Public VITE_MULTIPLAYER_URL comes from a GitHub repository
  variable and must be a credential-free wss URL ending /ws, without query or fragment.
  Empty means Solo-only availability, not localhost. Reject nonempty invalid release
  URLs before build; keep the existing Pages base path and deployment workflow.
- Run all syntax/tests/build on PRs and main, deploy Pages only from main/manual main.
  Preserve older protocol v1 allowlisting; new optional health features identify the
  Stage 8 session implementation. New clients refuse incompatible health versions or
  missing session capability before sending any create/join message. Wrong WebSocket
  protocol versions continue to fail visibly. Frontend/backend deployments are not atomic.
- Provision backend first, verify health/CORS/WSS, then set the actual frontend variable,
  publish Pages and verify two clients. No periodic artificial keep-awake traffic.
  Render account access is absent in this workspace: finish/test/commit the repository
  deliverables and document the exact external handoff and pending acceptance.

## Server operations and security

- /health returns no-store small JSON {ok:true,v:1,features:[duel-session-v1]}; exact same
  origin allowlist as WSS, no credentials or room listings. During shutdown return 503.
- Validate resource limits, ports, log level and proxy configuration at startup. JSON
  lifecycle logs are allowlisted event/code/match/reason/status/count metadata only;
  never serialize requests, tokens, input streams or headers. Support silent/info logging.
- Default IP identity is the socket transport address. Provide opt-in TRUSTED_PROXY_CIDRS;
  only trust X-Forwarded-For if the direct peer is explicitly trusted, then walk from
  the right to the first untrusted valid IP. Malformed chains fall back to transport IP.
  Normalize IPv4-mapped addresses. Never enable blanket forwarding trust or assume Render
  proxy ranges. Keep the blueprint's trust list empty until the operator verifies the
  actual ingress/header behavior; document shared-edge rate-limit tradeoffs.
- SIGTERM/SIGINT stops timers/new sockets, sends terminal interruption, drains connections
  with a bounded forced close, and exits. Repeated close calls await the same shutdown.
  Rooms stay in memory; deploys/restarts lose rooms, and clients cannot invent results.

## Client wake-up flow

- Before an explicit create/join, derive HTTP(S) /health from the configured WS(S) origin.
  Keep tokens and credentials out of health requests; omit credentials, bypass cache,
  reject redirects. No wake request on page load, Solo, or just selecting Online Duel.
- Display Waking server with remaining time; disable duplicate room submissions, expose
  Cancel and Retry, and keep Solo available. Each attempt has an eight-second cap and
  the entire flow a 90-second hard bound, with delays 1/2/4/8/8... seconds. Handle HTML
  loading pages, invalid JSON, network errors and 5xx as not ready; fail immediately on
  incompatible version/capability and configuration/auth/origin HTTP errors.
- Cancellation aborts fetch/delay, ignores late callbacks, prevents a late room request,
  and resets controls. A successful health check opens one socket and sends one original
  create/join request; no automatic room creation retries. Socket recovery keeps Stage 7's
  separate 30-second grace rather than spending 90 seconds waking a lost room.

## Verification and completion

Test health URL derivation, ready/cold HTML/network failures, compatibility, request
caps/deadline, cancellation/retry and stale callbacks with injected dependencies. Test
UI duplicate prevention, explicit gestures, cancellation into Solo, and no create before
health. Real sockets verify health/CORS/capabilities, origin/version/resource checks,
proxy trust boundaries and shutdown. Validate blueprint/workflow and release URL checks,
run all regressions, production base-path build and two-page Chromium session smoke.
Record actual local results separately from external provision/Pages/phone acceptance.

## Sources checked 2026-11-12

- https://render.com/docs/free — free limits, idle sleep, cold start, quota suspension.
- https://render.com/docs/blueprint-spec — free web service fields and checksPass.
- https://render.com/docs/node-version — supported Node version configuration.
- https://render.com/docs/websocket — public WSS and ordinary match heartbeats.
- https://expressjs.com/en/guide/behind-proxies/ — explicit trust-boundary principles.

## Implementation and verification record

Implemented on 2026-11-12: render.yaml, PR/main release workflow, public backend build
validation, explicit wake/cancel/retry UI, health compatibility, server resource/config
validation, opt-in CIDR proxy trust, sanitized lifecycle logging and bounded shutdown.
Full operational instructions and the pending hosted acceptance record are in
[DEPLOYMENT.md](../DEPLOYMENT.md). Solo gameplay/save modules remain unchanged.

Local verification:

- `npm test`: 172 tests passed, including 28 real-socket server tests, 21 online UI
  tests and nine release/wake/operations tests. Includes cold HTML/network failures,
  bounded retries/hung requests, cancellation and late callbacks, compatibility errors,
  proxy spoofing/trust boundaries, log projection and actual CLI SIGTERM exit.
- `npm run check`: passed.
- Production base-path builds passed with no backend configured and with an example
  public secure URL; verified the configured value reaches the built client and restored
  the unconfigured build afterward. No example URL was set in an external application.
- `npm run test:browser`: passed in two Chromium pages, with simulated loading HTML,
  visible Waking server/Cancel, cancellation back to Solo, no delayed health retry,
  successful retry/create and the existing gameplay/reconnect/pause/rematch/history
  session checks. No runtime exceptions. Portrait and landscape controls fit.
- Inspected `/tmp/brickfall-stage9-waking.png` and portrait screenshots; remaining
  local artifacts include `/tmp/brickfall-stage9-landscape.png`.
- render.yaml passed JSON Schema validation using Render's official
  `https://render.com/schema/render.yaml.json`; parsed the workflow and verified PR
  checks, main-only publication and the public repository-variable binding. This is
  local validation, not a completed GitHub Actions or Render deployment.
- `git diff --check`: passed.

No Render tool/account credential is configured in the attached environment. No backend
service, actual backend URL, repository variable, push or Pages deployment was created.
Stage 9's hosted checkpoint remains pending: provision Free service, verify health/CORS/
public WSS, configure the actual Pages backend variable, publish and validate two clients.
Stage 10 physical devices and real networks remain after that checkpoint. No paid
resources, database, disk or artificial keep-awake traffic were added.
