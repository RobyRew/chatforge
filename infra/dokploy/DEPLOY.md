# ChatForge on Dokploy

Use [the production recovery and release runbook](../../docs/production-recovery.md).
Production is a single-origin Compose deployment using `docker-compose.production.yml`:
CI-built, scanned images selected by digest; no VPS builds or development credentials.

Keep the existing Dokploy project identity and database volume. Route HTTPS only to web port
8080; nginx proxies `/api/` and `/ws` internally. PostgreSQL and Garage have no host port
bindings. Application secrets stay in Dokploy's protected environment, never in Git or build args.

Auto-deploy remains paused: every release is promoted by hand by updating the four
`CHATFORGE_*_IMAGE` digests in Dokploy and deploying. The root compose file is **local development
only**. The 2026-09-20 recovery is recorded in the runbook above.
