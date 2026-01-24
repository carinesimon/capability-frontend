# PROJECT_BRIEF — Capability Dashboard

## Goal
A real-estate performance dashboard (setters/closers) with unified global filters across all widgets and exports.

## Non-negotiables business rules
- Global filters must apply consistently to ALL widgets, drills, and exports.
- Source filter is dynamic: Lead.source comes from webhooks; list must reflect actual data.
- Metrics definitions:
  - Leads received = Lead.createdAt in [from,to] (tz-aware).
  - Stage-based metrics must use StageEvent.entered-in-stage where relevant.
  - WON uses wonFilter / won logic.
- Spotlight Setters/Closers must use the same metrics as Funnel/Pipeline.
- Timezone default: Europe/Paris.
- Filters: sources include/exclude, setterIds, closerIds, date range.

## Architecture constraints
- Minimal diffs. No repo-wide refactors unless requested.
- Reuse shared filter DTO/helpers and reportingGet wrapper.
- Verification required: lint/typecheck/build (front) and prisma validate/generate/build (api).
