# AGENTS.md — capability-api (Rules of Engagement)

## Non-negotiables
- No secrets committed. Never write real keys/tokens in code.
- Make changes as small, reviewable commits (1 feature = 1 PR).
- Always run lint + typecheck + tests/build if available.
- Keep API backward compatible unless explicitly asked.

## Project commands (try in this order)
- Install: pnpm install --frozen-lockfile (or npm ci)
- Lint: pnpm lint (or npm run lint)
- Typecheck: pnpm typecheck (or npm run typecheck)
- Tests: pnpm test (or npm test)
- Build: pnpm build (or npm run build)

## Prisma (if present)
- Generate: pnpm prisma generate
- Migrate: only if DATABASE_URL is available and safe to use.

## Output format
- Provide diffs per file with clear reasoning.
- If changing API, include example request/response.
- If changing DB, include migration steps and rollback notes.
