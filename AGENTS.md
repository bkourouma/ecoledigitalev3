<!-- SPECKIT START -->
## Active Spec Kit feature: specs/v2/000-platform-foundation

- Spec:  specs/v2/000-platform-foundation/spec.md
- Plan:  specs/v2/000-platform-foundation/plan.md (to be written)
- Design: research.md, data-model.md, contracts/, quickstart.md (same directory, once the plan exists)
- Index of v2 specs (000-033) and numbering rule: specs/v2/README.md
- Master documents: docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md (authoritative), docs/PRD_ScolarFlow_SaaS.md

New specs live in `specs/v2/` (configured by `specs_dir` in `.specify/init-options.json`,
overridable with the `SPECIFY_SPECS_DIR` environment variable). `specs/001..031` is the
**history** of the current application: keep it untouched and do not add new specs there.

Stack: TypeScript / Node 18+ monorepo (pnpm) — Fastify API (`apps/api`),
Next.js 15 App Router web (`apps/web`), shared Zod contracts
(`packages/contracts`), PostgreSQL 14+ with Row-Level Security, SQL
migrations in `infra/scripts/migrations`.

For technologies, project structure, shell commands, and implementation
details, read the plan above and its companion design documents before
working on this feature.
<!-- SPECKIT END -->
