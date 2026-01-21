# AGENTS.md — capability-frontend

## Mission
You are working on the capability-frontend (Next.js/React/TypeScript).
Deliver small, reviewable PRs. Keep changes minimal and consistent with existing patterns.

## Non-negotiables
- Do NOT commit secrets (.env, tokens, keys). Use environment variables in Codex settings.
- Avoid broad refactors unless explicitly requested.
- Keep API contracts stable unless the task explicitly changes them.
- Prefer strict types (no `any`) in new/modified code. If legacy requires `any`, isolate and document.

## Local commands (must pass before finishing a task)
- Install: `pnpm install --frozen-lockfile` (or `npm ci`)
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck` (tsc --noEmit)
- Build: `pnpm build`

## Environment expectations
- `NEXT_PUBLIC_API_URL` must be set for builds.
- `TZ` defaults to `Europe/Paris`.
- `NODE_ENV` should be `development` for Codex tasks.

## Output format
- Provide diffs per file with a short rationale.
- If a change impacts UI behavior, include a before/after description.
- If you introduce a new util/component, place it in the existing folder convention.

## UI / Code conventions
- Reuse existing components, hooks, and utilities before adding new ones.
- Keep formatting consistent; do not reformat unrelated files.
- For charts/formatters: accept `undefined/null` inputs (Recharts often passes them).
