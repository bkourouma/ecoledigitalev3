<!-- SPECKIT START -->
## Active Spec Kit feature: 030-pedagogie-ue-ecue

- Spec:  specs/030-pedagogie-ue-ecue/spec.md
- Plan:  specs/030-pedagogie-ue-ecue/plan.md
- Design: research.md, data-model.md, contracts/, quickstart.md (same directory)

Stack: TypeScript / Node 18+ monorepo (pnpm) — Fastify API (`apps/api`),
Next.js 15 App Router web (`apps/web`), shared Zod contracts
(`packages/contracts`), PostgreSQL 14+ with Row-Level Security, SQL
migrations in `infra/scripts/migrations`.

For technologies, project structure, shell commands, and implementation
details, read the plan above and its companion design documents before
working on this feature.
<!-- SPECKIT END -->
