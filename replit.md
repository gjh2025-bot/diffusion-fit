# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Artifacts

- **diffusion-fit** (`artifacts/diffusion-fit`, served at `/`) — React + Vite single-page tool for fitting `U(t) = k0 + a·exp(−b·t)` to open-circuit potential decay data. Uses `ml-levenberg-marquardt` for nonlinear least squares with `k0` held fixed; initial guesses come from log-linearization. Also takes electrolyte thickness `l` and computes the solid-state diffusion coefficient `Ds = l²·b/π²`, with a dimensionless-time cutoff check `τ = b·t/π² ≥ threshold` (default 0.03). When auto-trim is enabled, the earliest data points are iteratively dropped and the model refit until the cutoff at the new `t_min` is satisfied (or fewer than 3 points remain). A second **Comparison Plot** view (accessed via the "Comparison plot" button) lets users configure and fit multiple datasets at once, each with its own title, salt concentration, k0, l, threshold, and auto-trim settings. After running all fits, it shows a `Ds vs. concentration` recharts ComposedChart with individual jittered points, group mean markers, ±1 SD error bars, a dashed mean-trend line, a group statistics table, and a full "All results" table with cutoff badges and R². CSV export includes group stats and per-row metadata. Frontend-only; no backend or DB. Files: `src/App.tsx`, `src/pages/ComparisonPage.tsx`, `src/lib/fit.ts`, `src/lib/parse.ts`.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
