# Threat Model

## Project Overview

This repository is a pnpm TypeScript monorepo with two production artifacts and several shared libraries. The primary production app is `artifacts/diffusion-fit`, a static React/Vite single-page tool that runs nonlinear fitting on user-supplied electrochemistry datasets entirely in the browser. A second production artifact, `artifacts/api-server`, is an Express 5 server currently exposing only `/api/healthz`. Shared packages include generated API clients and a PostgreSQL/Drizzle database library, but the current production API does not use the database.

Assumptions for production scope:
- `NODE_ENV=production` in deployed services.
- Replit provides TLS for deployed traffic.
- `artifacts/mockup-sandbox` is development-only and should be ignored unless production reachability is demonstrated.

## Assets

- **User-supplied scientific datasets** — CSV/text input pasted into the fitter or loaded from local files. These may be confidential research data even though the app currently processes them locally in the browser.
- **Browser-stored analysis state** — the comparison page persists dataset entries in `localStorage`. This can contain titles, concentrations, model inputs, and raw uploaded data.
- **Application availability and integrity** — the fitter must remain stable when parsing malformed data, generating charts, and exporting results. The API health endpoint must remain lightweight and not expose internals.
- **Deployment secrets and database credentials** — `DATABASE_URL` and any future service credentials used by shared libraries or later API routes. These are not currently exposed to the client and must remain server-only.
- **Server logs and error output** — request metadata and future API errors must not leak cookies, bearer tokens, stack traces, or secret configuration.

## Trust Boundaries

- **Browser input to client application** — pasted text, uploaded CSV/TSV/TXT files, and locally persisted state are untrusted and must be treated as attacker-controlled.
- **Browser to API boundary** — public requests to `/api/*` cross from an untrusted client into the Express server. Every future non-public API route will need explicit authentication and authorization because the current API is entirely public.
- **API to environment / database boundary** — server code and shared DB libraries can access `process.env` and PostgreSQL credentials. Any future use of these libraries in production routes would make injection and secret exposure high-risk.
- **Production vs dev-only boundary** — `artifacts/mockup-sandbox`, Vite dev behavior, and local scripts are not part of the production deployment unless separately exposed.

## Scan Anchors

- **Production entry points**
  - `artifacts/diffusion-fit/src/main.tsx`
  - `artifacts/api-server/src/index.ts`
  - `artifacts/api-server/src/app.ts`
- **Highest-risk code areas**
  - `artifacts/diffusion-fit/src/App.tsx`
  - `artifacts/diffusion-fit/src/pages/ComparisonPage.tsx`
  - `artifacts/diffusion-fit/src/lib/parse.ts`
  - `lib/api-client-react/src/custom-fetch.ts`
  - `artifacts/api-server/src/lib/logger.ts`
- **Surface classification**
  - Public: the static fitter UI and `/api/healthz`
  - Authenticated/admin: none today
  - Shared but not currently exercised by production routes: `lib/db`, generated API client packages
- **Usually dev-only**
  - `artifacts/mockup-sandbox/**`
  - Vite development plugins/config paths
  - `scripts/**`

## Threat Categories

### Tampering

The core trust boundary in this project is untrusted dataset input entering the browser app through text areas, file uploads, and `localStorage`. The client must parse malformed or hostile input safely, avoid interpreting user content as code or markup, and keep exports faithful to the entered data without creating script execution paths. Future API routes must validate all request bodies and query parameters server-side; client-side validation alone would not be sufficient.

Required guarantees:
- User-controlled dataset content and labels MUST be rendered as text, not executed as HTML, script, or CSS.
- Parsing logic MUST fail safely on malformed input and MUST NOT invoke dynamic code execution.
- CSV and spreadsheet exports MUST correctly escape delimiters and quotes and MUST neutralize formula-leading characters in attacker-controlled cells.
- Any future API endpoints MUST validate and normalize request input on the server before use.

### Information Disclosure

The primary confidentiality risks are exposure of research data stored in the browser, accidental leakage of secrets from server-side libraries, and verbose logging or errors from the API. The current Express server already redacts authorization and cookie headers in logs; that protection must remain in place as routes expand. Shared server-only libraries such as `lib/db` and environment-backed configuration must never be bundled into client code or echoed in API responses.

Required guarantees:
- Server logs MUST continue to redact bearer tokens, cookies, and `Set-Cookie` headers.
- Client bundles MUST NOT expose server-only secrets such as `DATABASE_URL` or future API keys.
- API errors MUST avoid leaking stack traces, environment values, or internal infrastructure details.
- Browser-persisted analysis state SHOULD be limited to data users expect to keep locally.

### Denial of Service

Current server-side DoS exposure is low because the API only serves a simple health check. The more realistic risk is future expansion of public API routes or expensive client-side operations on extremely large datasets. As the API grows, public endpoints must remain bounded and cheap; as the client evolves, imports and exports should not freeze the UI on trivially hostile inputs.

Required guarantees:
- Public API endpoints MUST remain lightweight, bounded, and free of unnecessary expensive work.
- Any future upload or analysis route on the server MUST enforce size and time limits.
- Client-side parsing and export paths SHOULD degrade safely on oversized inputs instead of crashing unpredictably.

### Elevation of Privilege

There are no authenticated or admin-only production surfaces today, so classic access-control bugs are not presently reachable. The main future risk is that shared API client and DB infrastructure could make it easy to add protected routes without complete server-side checks. If authentication or privileged actions are introduced later, authorization must be enforced server-side from the first route.

Required guarantees:
- Any future authenticated route MUST require server-side identity verification.
- Any future privileged route MUST enforce role or ownership checks server-side.
- Any future database-backed route MUST use safe query construction and must not expose unrestricted records across tenants or users.
