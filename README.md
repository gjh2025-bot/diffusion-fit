# Diffusion Coefficient Fitter

A browser-based tool for fitting **U(t) = k₀ + a·exp(−b·t)** to open-circuit potential (OCP) decay data and extracting the solid-state diffusion coefficient **Dₛ**.

**Live site:** https://Diffusion-2026sg.replit.app

## Features

- Nonlinear least-squares fitting (Levenberg–Marquardt) with k₀ held fixed
- Auto-trim early-time data based on dimensionless-time cutoff τ = b·t/π² ≥ threshold
- **Auto-optimize R²** — multi-start optimizer tries multiple initial guesses; configurable target and attempt limit
- Re-run the same dataset without refreshing the page
- **Comparison Plot** — fit multiple datasets, group by salt concentration, plot Dₛ vs. concentration with ±SD/SE error bars
- Dataset configurations auto-saved in the browser
- Export: fit results as CSV, comparison chart as PNG, comparison data as CSV
- All computation runs in the browser — data never leaves the page

## Stack

- React + Vite + TypeScript · Tailwind CSS + shadcn/ui · Recharts · ml-levenberg-marquardt · pnpm workspaces

## Getting Started

```bash
pnpm install
pnpm --filter @workspace/diffusion-fit run dev
```

## Key Files

```
artifacts/diffusion-fit/src/
  App.tsx                  # Single-dataset fitter
  pages/ComparisonPage.tsx # Multi-dataset comparison view
  lib/fit.ts               # Fitting, auto-trim, multi-start optimizer, Dₛ
  lib/parse.ts             # CSV / tabular data parsing
```
