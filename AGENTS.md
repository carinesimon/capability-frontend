# AGENTS.md — capability-frontend

## Mission
You are working on capability-frontend (Next.js / React / TypeScript).
Deliver changes with maximal precision and minimal diffs. Prefer small, reviewable PRs.

---

## Operating mode (non-negotiable)

### Rule 1 — Clarify before acting
If you are not 100% certain about the current state (code/files/context/objective/acceptance criteria), STOP and ask ONLY the essential questions needed to remove ambiguity.
Do not implement changes until ambiguity is resolved.

Examples of acceptable questions:
- Which repo/branch and which pages/widgets must be impacted?
- What is the expected behavior (before/after) and acceptance criteria?
- Should filters be URL-synced and persisted? (if relevant)

### Rule 2 — Surgical execution
Once clarified:
- Change only what is required to reach the objective.
- Avoid broad refactors, unrelated formatting, or mass renames.
- Reuse existing patterns/hooks/utils before creating new ones.
- Keep API contracts stable unless explicitly requested to change them.

### Rule 3 — Verification required
After changes, run the required checks and report PASS/FAIL with exact errors if any.

### Rule 4 — If something cannot be done here
If a step cannot be performed due to environment constraints (missing access, missing secrets, private infra):
- Explain precisely why.
- Provide step-by-step manual instructions: what to do, where, and how to verify success.

---

## Security & data handling
- NEVER commit secrets (.env, tokens, keys). Use Codex environment variables instead.
- Never put secret values inside code, logs, or comments.
- `NEXT_PUBLIC_*` variables are public and must not contain secrets.

---

## Required commands (must pass before finishing a task)
- Install: `pnpm install --frozen-lockfile` (preferred) or `npm ci`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck` (tsc --noEmit)
- Build: `pnpm build`

If a check fails due to pre-existing issues unrelated to the requested task:
- Call it out explicitly and do not attempt a repo-wide cleanup unless asked.

---

## Environment expectations
- `NEXT_PUBLIC_API_URL` must be set for builds.
- `TZ` defaults to `Europe/Paris`.
- `NODE_ENV` should be `development` for Codex tasks.

---

## Output format
For each task, provide:
1) Summary of changes (what/why)
2) Per-file diffs (or linked diff) with short rationale
3) Verification results (commands + PASS/FAIL)
4) Any manual steps (only if necessary) with validation instructions

---

## UI / Code conventions
- Keep formatting consistent; do not reformat unrelated files.
- For charts/formatters (Recharts): accept `undefined/null` and array inputs; use narrowing (`typeof`, `Array.isArray`) and safe `Number(...)` guards.
- Prefer strict typing; avoid `any` in new/modified code. If legacy requires `any`, isolate it and document it.

---

## Definition of Done
A task is done when:
- The objective is reached exactly as specified,
- Required checks pass (or failures are explicitly identified as pre-existing),
- The diff is minimal and reviewable,
- No secrets were added or leaked.
