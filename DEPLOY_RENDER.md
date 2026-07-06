# Render Deployment Runbook

## Do Not Commit The SQLite Database

The current SQLite database is private runtime data. It should not be committed to GitHub.

The migration works by running locally from the private SQLite file to the Render Postgres external database URL:

```powershell
cd matcher-app
$env:DATABASE_URL = "postgresql://render-external-url"
node scripts/migrate-sqlite-to-postgres.mjs --source-root web-data --out migration-output/render-apply --apply
```

That copies the current local app state into Render Postgres without placing pupil/survey data in Git.

## Current Runtime State

The hosted runtime now uses Postgres through `server/matcher-postgres-server.ts`.

The legacy local server entrypoint still exists at `server/matcher-web-server.ts` and continues to use `sql.js`/SQLite. Render/Docker uses the hosted build:

```powershell
npm run build:hosted
npm run start:hosted
```

For local HTTP smoke tests against Postgres, set `COOKIE_SECURE=false`. Do not set that on Render; secure cookies are the default there.

## GitHub Prep

Before pushing:

```powershell
git status --short
git add .gitignore .dockerignore Dockerfile render.yaml DEPLOY_RENDER.md matcher-app/.env.example matcher-app/db matcher-app/scripts scripts matcher-app/server matcher-app/src matcher-app/package.json matcher-app/package-lock.json matcher-app/components.json matcher-app/index.html matcher-app/postcss.config.cjs matcher-app/tailwind.config.js matcher-app/tsconfig.json matcher-app/vite.config.ts survey_matcher_deployment_decisions.md survey_roster_matcher_app_spec.md
```

Check carefully that no files from these paths are staged:

```text
outputs/
matcher-app/web-data/
matcher-app/dev-data/
matcher-app/seed-outputs/
matcher-app/migration-output/
school files.zip
survey data.zip
```

## Render Blueprint

The `render.yaml` file defines:

- one Docker web service
- one managed Render Postgres database
- `DATABASE_URL` from the internal Render Postgres connection string
- generated `AUTH_SECRET`
- prompted `MATCHER_BOOTSTRAP_PASSWORD`
- auto deploy disabled
- the hosted Postgres runtime entrypoint

Docker is used instead of Render's plain Node runtime because the app still calls Python scripts for raw Qualtrics processing. The image installs Node, Python, and `openpyxl`.

## Initial Hosted Migration Order

1. Push code to GitHub.
2. Create the Render Blueprint from the GitHub repo.
3. Set `MATCHER_BOOTSTRAP_PASSWORD` when Render prompts for it.
4. Let Render create the Postgres database.
5. Copy the Render Postgres external database URL from the dashboard.
6. Run the local migration command against that external URL.
7. Run verification. The migration script fails if table counts differ.
8. Deploy/start the hosted service.
9. Log in with the bootstrap admin account.
