# Survey Matcher Deployment Decisions

## Context

The survey matcher started as a local Electron/SQLite review tool, but the current direction is to make it usable by multiple colleagues through a hosted browser app. The app handles pupil roster and survey response data, so deployment needs to be simple but not casual: authentication, auditability, and concurrency safety matter.

## Current Direction

- Move from local Electron-only usage to a hosted browser app.
- Keep the existing React frontend and Node server direction.
- Keep Python processing scripts available server-side for raw Qualtrics imports.
- Use a hosted platform rather than a low-level VPS/EC2-style setup.
- Use a hosted Postgres database before serious multi-user use.

## Local Development Decision

Development can proceed locally before Render deployment.

When colleagues are actively using the current running app, design and feature work should use a separate local development server on a different port and a copied development data directory. Source-code edits and development builds must not touch the live matcher data or require restarting the live server until changes are ready to promote.

## Application Shape Decision

Use one Render web service for the hosted app.

The service should:

- Serve the React browser app.
- Provide the Node API.
- Run/import via the existing Python processing scripts when needed.

Do not split frontend and backend into separate hosted services for the first hosted version.

## Processing Decision

Keep the Python processing pipeline.

Node should own the web app, API, auth, sessions, database access, exports, and user-facing workflow. Python should continue to own the data processing tasks it is already good at:

- raw Qualtrics parsing
- roster/source normalization when needed
- dedupe processing
- match candidate generation

Do not port the Python logic to Node unless there is a specific later reason. For imports, Node should call Python server-side, then import validated processed results into the hosted database.

## Hosting Decision

Use Render for the hosted version.

Reasons:

- Suitable for a small internal web app.
- Can host the Node backend and serve the frontend.
- Provides managed Postgres.
- Provides a default public domain, so a custom domain is not required initially.
- Handles HTTPS/TLS for the deployed service.
- Lower operational burden than managing a VPS.
- More predictable for this project than Railway's usage-based pricing.
- Cheaper and simpler operationally than AWS once the value of managed deployment, HTTPS, and database administration is considered.

Initial paid Render setup:

```text
Starter web service       ~$7/month
Basic-256mb Postgres      ~$6/month
Expected total            ~$13/month
```

Do not use Render's free web service for the main hosted version if colleagues will rely on it, because the free service spins down when idle and has cold starts. It can still be used for temporary previews or experiments.

Do not use Render's free Postgres for real data. The free database expires after 30 days and is not appropriate for pupil/survey matching work.

## Domain Decision

Do not buy or configure a custom domain for the first hosted version.

Use the platform-provided Render URL, expected to be in the form:

```text
<service-name>.onrender.com
```

A custom domain can be added later if the app becomes more permanent or needs a cleaner URL.

## Database Decision

The current local `sql.js`/SQLite file-backed setup is acceptable for local/LAN testing, but is not the right database model for multiple people using the hosted app at the same time.

For hosted multi-user use:

- Move the app database to Postgres.
- Keep the data model decision-based and auditable.
- Use database transactions and constraints to prevent collisions.
- Keep imports append-only where possible.

Core constraints expected:

- One active decision per survey response.
- One active matched response per roster pupil.
- A second user trying to decide an already-decided response should receive a clear "already decided" message and refresh.
- A second user trying to match an already-matched pupil should receive a clear conflict message.

## Authentication Decision

Use simple built-in username/password authentication.

Do not use OAuth, magic links, registration, SSO, or a shared access token for the first hosted version.

Implementation direction:

- Fixed named user accounts.
- Users should live in the application database, not only in environment variables.
- Passwords stored as hashes, not plaintext.
- Server creates a secure `HttpOnly` session cookie after login.
- All API routes require a valid session.
- Decisions, imports, exports, and destructive/revising actions record the username in the audit trail.

Expected server routes:

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

Expected environment variables:

```text
AUTH_SECRET=<long-random-secret>
```

## Permissions Decision

Do not add roles for the first hosted version.

All logged-in users can use the same application functions. User attribution still matters: decisions, imports, exports, roster edits, and undo/revise actions must record who performed them.

## Multi-User Decision

Avoid complex real-time collaboration initially.

Use a simple "first write wins" model:

- The UI can show the next available response.
- When a user commits a decision, the server writes inside a transaction.
- If another user already decided that response or matched that pupil, the write fails cleanly.
- The client refreshes and moves on.

Soft locks can be added later if users repeatedly collide, but they are not part of the first hosted version.

## Product Direction

The app should become a broader data workbench, not just a matching queue.

Planned areas:

- Review queue for matching.
- Matched data table.
- Roster coverage view.
- Response search and inspection.
- Pupil search and inspection.
- Import history and import result summaries.
- Data quality/conflict views.
- Exports for roster coverage and matched pupil-response data.
- Audit log showing who did what and when.

## Workbench Product Decisions

### Interface Structure

Use a persistent left sidebar as the main navigation model.

Initial navigation:

- Dashboard
- Match Queue
- Pupils
- Responses
- Matches
- Schools
- Imports
- Data Quality
- Exports
- Audit

The dashboard should become the app entry point, while the match queue remains the primary action workflow.

### Visual Direction

The app should have a polished, considered, professional interface.

Use a quiet operational-tool style:

- light theme by default
- dark mode with a visible toggle
- compact tables
- strong typography
- restrained colour
- consistent status badges
- clear hierarchy
- minimal decorative UI
- high information density without feeling cramped

Adopt actual shadcn/ui components for the design pass rather than only loosely imitating the style. Existing Tailwind/lucide usage is fine, but the hosted workbench should use real shadcn-style primitives/components where appropriate.

### Record Detail Pattern

Prefer full pages for substantial record detail views.

Use modals only where a full page is not justified, such as confirmations, compact edits, imports, or focused decision dialogs.

Do not use slide-over drawers as the default detail pattern.

### Table Behaviour

Tables should be treated as serious working tools.

Expected behaviour:

- search
- filters
- school filter where relevant
- sortable columns
- sticky headers where useful
- pagination or virtualized scrolling where needed
- direct export where relevant

### Queue Filters

The matching queue should support school-by-school working.

School filters should also be available across most workbench views where the data naturally relates to a school.

### Status Language

Use these canonical statuses unless a later product reason changes them:

- response: `unreviewed`, `matched`, `deferred`, `ambiguous`, `duplicate`, `no_match`
- pupil: `available`, `matched`, `withdrawn`
- import: `completed`, `completed_with_warnings`, `failed`

### Dashboard

Add a proper landing dashboard. It should give a quick operational picture of the project, including:

- total roster pupils
- total survey responses
- matched count
- unmatched response count
- unmatched pupil count
- deferred, ambiguous, duplicate, and no-match counts
- school-by-school matching/progress summary

Use a polished, work-focused dashboard style suitable for shadcn-style components.

### Inspection Views

The hosted app should include core inspection views beyond the matching queue:

- all pupils table
- all responses table
- matched links table
- school dashboard
- single pupil detail
- single response detail
- import history

These views should support searching, filtering, and inspecting records without needing to use Excel.

### Export Catalogue

The initial export catalogue should include:

- matched pupil-response full export
- roster coverage export
- unmatched roster pupils
- unmatched or unresolved responses
- ambiguous decisions
- deferred decisions
- duplicate response decisions
- no-match decisions
- full audit log
- school-level progress summary

Exports should be generated from the live database state.

### Decision Revision Policy

Users must be able to revise any previous decision, not only undo their own most recent action.

Revisions must be explicit and audited. The app should preserve the previous decision history rather than overwriting it invisibly.

Revision notes should be optional, not mandatory, because mandatory notes would slow down legitimate correction work. The UI should still make it clear that the user is replacing/revising an existing decision.

### Duplicate Response Policy

Duplicate responses are manually marked by users.

Duplicate responses should be excluded from the main matched pupil-response export by default, but included in a separate duplicate/unresolved export so they remain visible and auditable.

### Roster Edit Policy

Users may:

- add a new roster pupil
- withdraw a roster pupil
- edit/correct an existing roster pupil only through an explicit correction action

Roster edits must be audited. Corrections should preserve enough history to understand what changed and who changed it.

When a new roster pupil is added through the interface, they must be normalized and processed so they are usable in match suggestions. Adding a pupil should not merely create a passive record; it should update the candidate matching surface for unresolved responses.

Withdrawn pupils should remain visible in the app with a clear withdrawn status, but must not be available for matching.

Withdrawn pupils should not appear in roster coverage exports by default.

### Raw Import Visibility

Raw Qualtrics upload files should be preserved indefinitely for provenance, but users should not casually download raw source uploads from the app by default.

The app should show import metadata and import results, including the uploaded filename, import time, user, number of raw rows, number of new responses, skipped existing responses, generated candidate rows, and any import warnings/errors.

### Data Quality Tools

The hosted app should include data quality views for:

- possible duplicate roster pupils
- responses with no candidates
- responses with multiple high-confidence candidates
- matched pupils with later duplicate responses
- schools with low completion or match coverage
- missing or invalid DOBs

### Finalization

Do not add a project-finalized or locked mode for the first hosted version.

The app should support revision and correction as new information becomes available.

## Import Decision

Raw Qualtrics import should remain server-side.

The uploaded file may contain the full Qualtrics export, not just new responses. Existing response IDs should be skipped. New response IDs should be processed and inserted without disturbing existing match decisions.

Raw uploaded source files should be preserved, along with import metadata and result summaries.

Current import principle:

- Existing response IDs are stable and should not be updated.
- New response IDs are appended.
- Existing decisions are preserved.
- Candidate rows are generated for newly added responses.

## Export Decision

Exports should be generated live from the current database state.

Do not rely on manually maintained export spreadsheets as runtime state. Export actions should be audited so it is possible to see who exported what and when.

Confirmed baseline exports:

- matched pupil-response export containing roster pupil data and linked survey response data
- roster coverage export showing every roster pupil and their match status

## Migration Decision

The current matcher data and current SQLite decisions are the source of truth for the first hosted migration.

Existing decisions should be migrated as-is. The migration should not rerun dedupe or automatically replace existing matches.

The SQLite database itself must not be committed to GitHub. The migration should be run from the local private SQLite data directory directly into the hosted Render Postgres database using Render's external Postgres connection URL. Code, schema, and migration tooling belong in Git; pupil/survey runtime data does not.

The hosted runtime now has a Postgres server entrypoint at `matcher-app/server/matcher-postgres-server.ts`. The legacy local web server entrypoint remains SQLite-backed for local fallback.

## Render Configuration Decision

Use a Render Blueprint committed as `render.yaml`.

The first hosted service should use Docker rather than Render's plain Node runtime, because the app still invokes Python scripts for raw Qualtrics processing. The Docker image should contain:

- Node 20
- Python 3
- `openpyxl`
- the React/Node app
- the existing Python processing scripts

Auto deploy should be disabled initially so a Git push cannot accidentally replace a working app before migration and smoke testing are complete.

Render/Docker should build and start the hosted Postgres entrypoint:

```text
npm run build:hosted
npm run start:hosted
```

## Current Non-Goals

- No custom domain for the first hosted version.
- No public registration.
- No password reset emails.
- No OAuth/SSO unless later required.
- No roles/permissions split initially.
- No complex real-time locking initially.
- No automatic replacement of matched responses when a more complete duplicate appears.

## Open Implementation Work

- Validate the Postgres runtime against the real migrated database.
- Add user attribution to decisions/imports/exports/audit events.
- Add server-side transaction checks for match collisions.
- Add or refine data workbench views.
- Finish and validate Render deployment configuration.

## Remaining Development Actions

This section is the practical handoff checklist for continued development.

### Current Local State

- The live LAN/browser app has been kept on `http://127.0.0.1:4173/`.
- The live app currently uses `matcher-app/dist` plus the Node web API and `matcher-app/web-data`.
- Do not rebuild or overwrite `matcher-app/dist` while someone is using the live app unless intentionally promoting a tested build.
- A web compatibility bridge was added to `matcher-app/dist/index.html` so the currently served browser build can use `/api/*` when `window.matcher` is not available.
- Design/development work should continue against the isolated Vite app at `http://127.0.0.1:5174/`.
- The isolated dev API runs on `http://127.0.0.1:4181/` and uses copied data under `matcher-app/dev-data`.

### UI Migration State

The app source is mid-way through a design-system migration.

Completed or started:

- Actual `shadcn/ui` has been installed and configured.
- The main shell uses the real shadcn sidebar component.
- The app has a dark-mode toggle.
- Dashboard has been started but still needs design refinement.
- Match queue has been updated to keep the response facts in a compact grid while preserving the side-by-side review/search layout.
- Matches page has been migrated to shadcn `Card`, `Input`, `Button`, `Table`, and `Badge` primitives.

Still to do:

- Continue migrating custom controls in Match Queue to shadcn primitives.
- Rework Add Pupil form with shadcn form/input/button/dialog components.
- Rework Help modal using shadcn `Dialog`.
- Migrate Exports and Imports pages to the same design system.
- Build real Pupils, Responses, Schools, Data Quality, and Audit pages.
- Check dark mode after each page migration.
- Keep table layouts dense and functional; avoid decorative dashboard/card-heavy patterns.

### Current Technical Caveats

- Some generated shadcn components used Tailwind 4 syntax and have been manually adjusted for the current Tailwind 3 project.
- If more shadcn components are added, check for Tailwind 4-only utility syntax such as `w-(--var)`, `max-h-(--var)`, `gap-(--var)`, or `size-8!`, and convert to Tailwind 3-compatible forms.
- Do not run `npm run build:web` casually, because it writes to `matcher-app/dist` and can affect the live browser app.
- Use `npx tsc --noEmit` for source validation during design work.
- Use the Vite design server on port `5174` for browser checks.

### Near-Term UI Tasks

1. Finish the design pass page by page:
   - Match Queue
   - Matches
   - Exports
   - Imports
   - Add Pupil
   - Help
   - Dashboard

2. Add the missing workbench pages:
   - Pupils table and pupil detail page
   - Responses table and response detail page
   - Schools overview/detail
   - Data quality/conflict views
   - Audit log

3. Add cross-cutting table tools:
   - school filter
   - status filter
   - search
   - sortable columns
   - export action where relevant

4. Keep revision workflows prominent:
   - reopen/revise any decision
   - show current decision history
   - audit every revision

### Near-Term Backend Tasks

1. Add simple username/password auth:
   - users table
   - password hashes
   - session cookie
   - login/logout/me routes

2. Add audit attribution:
   - decisions
   - imports
   - exports
   - roster add/withdraw/correction
   - decision revisions

3. Prepare Postgres migration:
   - schema for roster pupils, survey responses, candidates, decisions, audit events, imports, users, sessions
   - migration/import from the current SQLite state
   - transaction-safe decision writing
   - constraints for one active decision per response and one active match per pupil
   - hosted Postgres runtime server for Render

4. Keep Python processing server-side:
   - raw Qualtrics upload
   - skip existing response IDs
   - generate candidates for new responses
   - preserve raw uploads and import metadata

### Promotion And Deployment Tasks

1. When a design/dev change is ready, explicitly decide how to promote it to the live local app.
2. Before promotion:
   - backup `matcher-app/web-data`
   - verify `npx tsc --noEmit`
   - verify browser flow on `5174`
   - verify import/export endpoints if touched
3. Prepare Render deployment:
   - one Docker web service
   - managed Postgres
   - environment variables for auth/session/database
   - build and start commands
   - persistent upload storage decision for raw imports
4. Run the first hosted migration locally from private SQLite data to Render Postgres using the Render external database URL. Do not commit SQLite or generated CSV/source data.
5. Do not deploy live hosted use until the migrated Render database has been smoke-tested through the hosted app.
