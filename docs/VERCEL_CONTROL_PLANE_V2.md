# EVAVO Vercel Control Plane V2

## Authority split

Vercel is a cloud provider and must not depend on EVAVO workstation liveness.

The V2 authority model is:

1. `vercel-provider-cloud-mcp` — preferred provider-control authority for Vercel projects, Git deployments and project domains. Runs in Cloudflare Workers and stores the Vercel credential only as a Worker secret.
2. Official Vercel connector — independent provider-native read/log/deployment evidence where the published connector exposes the needed operation.
3. Local `evavo-vercel-control` MCP — full Development Studio provider control when a local agent is intentionally operating on the workstation.
4. Workstation typed relay — fallback only. It is not a prerequisite for cloud Vercel administration.

Hardware, filesystem, local applications and other physical-machine effects remain workstation-only authorities.

## Failure isolation

A workstation outage must not make these capabilities unavailable:

- Vercel project inspection and creation;
- GitHub-linked production deployment creation;
- project-domain attachment, update and verification;
- exact Vercel DNS-plan retrieval for external registrars.

A Vercel provider outage must not be reported as a workstation outage.

No uncertain provider mutation may be automatically replayed through another ingress. Provider read-back is required before retry.

## Cloud provider relay

Source: `packages/vercel-provider-relay`.

The relay exposes:

- `GET /health` — coarse service/credential configuration only;
- authenticated `/mcp` — `evavo_vercel_provider_probe` and `evavo_vercel_provider_control`;
- authenticated `POST /api/control` — bounded JSON control API for reviewed automation.

Cloud secrets:

- `VERCEL_TOKEN`
- `CONTROL_TOKEN`

Non-secret configuration:

- `VERCEL_TEAM_ID`

Credential values are never returned in health, MCP responses or commissioning receipts.

## Commissioning

`scripts/Deploy-EvavoVercelProviderRelayV1.ps1`:

1. requires an existing local Cloudflare API credential and Vercel provider credential;
2. stores `VERCEL_TOKEN` and a generated/reused control token with `wrangler secret put`;
3. deploys the Worker;
4. verifies `/health`;
5. performs an authenticated read-only `project.list` provider probe;
6. returns the Worker/MCP URL but no credential value.

`EVAVO-STUDIO/evavo-local-compute/automation/remote-jobs/Run-EvavoVercelControlCommissionV2.py` commissions cloud provider control first. Workstation relay commissioning is a separate best-effort result and cannot veto provider readiness.

## Naomi Queen of Hearts acceptance case

The canonical public project target remains:

- project: `naomis30th`
- GitHub repo: `EVAVO-STUDIO/naomi-30-queen-of-hearts`
- branch: `main`
- root directory: `deployment/vercel-guest-r15`
- apex: `naomis30th.com`
- `www`: `www.naomis30th.com` -> 308 redirect to apex

The existing `naomi-30-queen-of-hearts` project remains the R13 session/authentication origin. The old `naomi-queen-of-hearts-guest` project remains rollback evidence until the Git-backed project and custom domain are verified.

Do not change Porkbun from generic Vercel examples. Attach the exact domains to the final Vercel project first, then obtain `domain.dns-plan` and use Vercel's live recommendations.
