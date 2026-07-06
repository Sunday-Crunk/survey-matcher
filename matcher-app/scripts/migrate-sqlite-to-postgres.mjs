import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultSourceRoot = process.env.MATCHER_DATA_ROOT
  ? path.resolve(process.env.MATCHER_DATA_ROOT)
  : path.join(appRoot, "dev-data");
const defaultOutRoot = path.join(appRoot, "migration-output");
const defaultSchemaPath = path.join(appRoot, "db", "hosted-postgres-schema.sql");
const historicalActor = "Historical SQLite migration";

const tableSpecs = [
  {
    name: "roster_children",
    columns: [
      "roster_child_id",
      "roster_file",
      "school_raw",
      "source_row",
      "forename_raw",
      "surname_raw",
      "dob_iso",
      "birth_month",
      "birth_year",
      "withdrawn_at",
      "withdrawn_by"
    ],
    defaults: { withdrawn_at: null, withdrawn_by: null },
    numeric: new Set(["source_row"])
  },
  {
    name: "survey_responses",
    columns: [
      "response_id",
      "survey_row_index",
      "entered_forename_raw",
      "entered_school_raw",
      "birth_month_year",
      "progress",
      "finished",
      "response_class",
      "recorded_date_raw",
      "dedupe_group_key",
      "dedupe_decision",
      "duplicate_response_classification",
      "manual_identifier_decision",
      "imported_at"
    ],
    defaults: { imported_at: null },
    numeric: new Set(["survey_row_index", "progress"])
  },
  {
    name: "survey_response_full_rows",
    columns: ["response_id", "raw_json"],
    jsonb: new Set(["raw_json"])
  },
  {
    name: "candidates",
    columns: [
      "response_id",
      "candidate_rank",
      "confidence",
      "preselected",
      "score",
      "top_gap",
      "school_score",
      "name_score",
      "dob_status",
      "reason_codes",
      "roster_child_id",
      "roster_forename",
      "roster_surname",
      "roster_school",
      "roster_birth_month_year",
      "roster_dob_iso"
    ],
    numeric: new Set(["candidate_rank", "score", "top_gap", "school_score", "name_score"])
  },
  {
    name: "decisions",
    columns: ["id", "response_id", "roster_child_id", "action", "note", "created_at", "created_by", "undone_at", "undone_by"],
    defaults: { created_by: historicalActor, undone_by: null },
    numeric: new Set(["id"])
  },
  {
    name: "roster_additions",
    columns: [
      "roster_child_id",
      "school_raw",
      "forename_raw",
      "surname_raw",
      "dob_iso",
      "birth_month",
      "birth_year",
      "sex",
      "upn",
      "created_at",
      "created_by"
    ],
    defaults: { sex: null, upn: null, created_by: historicalActor }
  },
  {
    name: "import_runs",
    columns: [
      "id",
      "imported_at",
      "imported_by",
      "raw_upload_name",
      "raw_upload_path",
      "backup_path",
      "raw_rows",
      "new_response_rows",
      "skipped_existing_responses",
      "candidate_rows",
      "status",
      "warnings_json",
      "error_message"
    ],
    defaults: {},
    numeric: new Set(["id", "raw_rows", "new_response_rows", "skipped_existing_responses", "candidate_rows"]),
    jsonb: new Set(["warnings_json"]),
    optional: true
  },
  {
    name: "audit_events",
    columns: ["id", "event_type", "occurred_at", "actor", "subject", "detail", "response_id", "roster_child_id"],
    defaults: { actor: historicalActor },
    numeric: new Set(["id"]),
    optional: true
  }
];

function parseArgs(argv) {
  const args = {
    sourceRoot: defaultSourceRoot,
    sqlite: "",
    out: "",
    schema: defaultSchemaPath,
    databaseUrl: process.env.DATABASE_URL || "",
    apply: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-root") args.sourceRoot = path.resolve(requireValue(argv, ++index, arg));
    else if (arg === "--sqlite") args.sqlite = path.resolve(requireValue(argv, ++index, arg));
    else if (arg === "--out") args.out = path.resolve(requireValue(argv, ++index, arg));
    else if (arg === "--schema") args.schema = path.resolve(requireValue(argv, ++index, arg));
    else if (arg === "--database-url") args.databaseUrl = requireValue(argv, ++index, arg);
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.sqlite) args.sqlite = path.join(args.sourceRoot, "outputs", "matcher_review.sqlite");
  if (!args.out) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    args.out = path.join(defaultOutRoot, stamp);
  }
  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function printHelp() {
  console.log(`Usage:
  node scripts/migrate-sqlite-to-postgres.mjs --source-root dev-data
  node scripts/migrate-sqlite-to-postgres.mjs --source-root web-data --out migration-output/live-preflight
  node scripts/migrate-sqlite-to-postgres.mjs --source-root web-data --database-url "$DATABASE_URL" --apply

Options:
  --source-root <dir>    Data root containing outputs/matcher_review.sqlite. Defaults to dev-data.
  --sqlite <file>        Direct SQLite database path. Overrides --source-root.
  --out <dir>            Output folder for migration.sql, verify.sql, and source-counts.json.
  --schema <file>        Postgres schema SQL file. Defaults to db/hosted-postgres-schema.sql.
  --database-url <url>   Postgres connection URL. Also read from DATABASE_URL.
  --apply                Apply schema, migration, and verification through psql.
`);
}

function rows(database, sql, params = []) {
  const stmt = database.prepare(sql);
  try {
    stmt.bind(params);
    const output = [];
    while (stmt.step()) output.push(stmt.getAsObject());
    return output;
  } finally {
    stmt.free();
  }
}

function one(database, sql, params = []) {
  return rows(database, sql, params)[0] ?? null;
}

function hasTable(database, tableName) {
  return Boolean(one(database, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [tableName]));
}

function tableColumns(database, tableName) {
  return new Set(rows(database, `PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`).map((column) => column.name));
}

function quoteSqliteIdentifier(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function readSourceRows(database, spec) {
  if (!hasTable(database, spec.name)) {
    if (spec.optional) return [];
    throw new Error(`SQLite source is missing required table: ${spec.name}`);
  }

  const available = tableColumns(database, spec.name);
  const sourceColumns = spec.columns.filter((column) => available.has(column));
  const selected = sourceColumns.length
    ? rows(database, `SELECT ${sourceColumns.map(quoteSqliteIdentifier).join(", ")} FROM ${quoteSqliteIdentifier(spec.name)} ORDER BY rowid ASC`)
    : [];

  return selected.map((row) => {
    const output = {};
    for (const column of spec.columns) {
      let value = available.has(column) ? row[column] : spec.defaults?.[column] ?? null;
      if ((value === null || value === undefined || value === "") && spec.defaults && column in spec.defaults) {
        value = spec.defaults[column];
      }
      output[column] = coerceValue(value, column, spec);
    }
    return output;
  });
}

function coerceValue(value, column, spec) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (spec.numeric?.has(column)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (spec.jsonb?.has(column)) {
    if (value === "") return null;
    try {
      JSON.parse(String(value));
    } catch (error) {
      throw new Error(`${spec.name}.${column} contains invalid JSON: ${error.message}`);
    }
  }
  return String(value).replace(/\u0000/g, "");
}

function pgLiteral(value, cast = "") {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  const escaped = String(value).replaceAll("'", "''");
  return `'${escaped}'${cast}`;
}

function insertSql(spec, tableRows) {
  if (tableRows.length === 0) return `-- ${spec.name}: no rows to migrate\n`;
  const columns = spec.columns.map((column) => `"${column}"`).join(", ");
  const statements = [];
  const chunkSize = 250;

  for (let index = 0; index < tableRows.length; index += chunkSize) {
    const chunk = tableRows.slice(index, index + chunkSize);
    const values = chunk
      .map((row) => {
        const cells = spec.columns.map((column) => {
          const cast = spec.jsonb?.has(column) && row[column] !== null ? "::jsonb" : "";
          return pgLiteral(row[column], cast);
        });
        return `  (${cells.join(", ")})`;
      })
      .join(",\n");
    statements.push(`INSERT INTO ${spec.name} (${columns}) VALUES\n${values};`);
  }

  return statements.join("\n\n") + "\n";
}

function sequenceResetSql() {
  return `
SELECT setval(pg_get_serial_sequence('decisions', 'id'), COALESCE((SELECT MAX(id) FROM decisions), 1), (SELECT COUNT(*) FROM decisions) > 0);
SELECT setval(pg_get_serial_sequence('import_runs', 'id'), COALESCE((SELECT MAX(id) FROM import_runs), 1), (SELECT COUNT(*) FROM import_runs) > 0);
SELECT setval(pg_get_serial_sequence('audit_events', 'id'), COALESCE((SELECT MAX(id) FROM audit_events), 1), (SELECT COUNT(*) FROM audit_events) > 0);
`;
}

function migrationSql(dataByTable, sourceCounts) {
  const body = tableSpecs.map((spec) => insertSql(spec, dataByTable.get(spec.name) ?? [])).join("\n");
  return `-- Generated SQLite to Postgres migration.
-- Source SQLite rows are inserted directly; dedupe and matching are not rerun.
-- The count gate runs before COMMIT so a mismatch rolls the load back.

BEGIN;

TRUNCATE TABLE
  audit_events,
  import_runs,
  roster_additions,
  decisions,
  candidates,
  survey_response_full_rows,
  survey_responses,
  roster_children
RESTART IDENTITY CASCADE;

${body}
${sequenceResetSql()}
${hardGateSql(sourceCounts)}
COMMIT;
`;
}

function verifySql(sourceCounts) {
  const values = Object.entries(sourceCounts)
    .map(([table, count]) => `  ('${table}', ${count}::bigint)`)
    .join(",\n");
  const actual = Object.keys(sourceCounts)
    .map((table) => `  SELECT '${table}' AS table_name, COUNT(*)::bigint AS actual_count FROM ${table}`)
    .join("\n  UNION ALL\n");

  return `-- Returns zero rows only when every migrated table count matches the SQLite source exactly.
WITH expected(table_name, expected_count) AS (
  VALUES
${values}
),
actual AS (
${actual}
)
SELECT
  expected.table_name,
  expected.expected_count,
  COALESCE(actual.actual_count, 0) AS actual_count
FROM expected
LEFT JOIN actual USING (table_name)
WHERE expected.expected_count <> COALESCE(actual.actual_count, 0)
ORDER BY expected.table_name;
`;
}

function hardGateSql(sourceCounts) {
  const values = Object.entries(sourceCounts)
    .map(([table, count]) => `    ('${table}', ${count}::bigint)`)
    .join(",\n");
  const actual = Object.keys(sourceCounts)
    .map((table) => `    SELECT '${table}' AS table_name, COUNT(*)::bigint AS actual_count FROM ${table}`)
    .join("\n    UNION ALL\n");

  return `DO $$
DECLARE mismatch_count integer;
BEGIN
  WITH expected(table_name, expected_count) AS (
    VALUES
${values}
  ),
  actual AS (
${actual}
  )
  SELECT COUNT(*) INTO mismatch_count
  FROM expected
  LEFT JOIN actual USING (table_name)
  WHERE expected.expected_count <> COALESCE(actual.actual_count, 0);

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'SQLite to Postgres migration count verification failed: % mismatched table(s)', mismatch_count;
  END IF;
END $$;
`;
}

function manifest(sourceRows, args) {
  const sourceCounts = Object.fromEntries([...sourceRows.entries()].map(([table, tableRows]) => [table, tableRows.length]));
  return {
    generatedAt: new Date().toISOString(),
    sourceRoot: args.sourceRoot,
    sqlite: args.sqlite,
    schema: args.schema,
    counts: sourceCounts,
    note: "Postgres must not be used until verify.sql returns zero mismatch rows."
  };
}

function assertNoSourceConflicts(database) {
  const checks = [
    {
      label: "multiple active decisions for one response",
      sql: `SELECT response_id, COUNT(*) AS count
            FROM decisions
            WHERE undone_at IS NULL
            GROUP BY response_id
            HAVING COUNT(*) > 1`
    },
    {
      label: "multiple active matched decisions for one roster pupil",
      sql: `SELECT roster_child_id, COUNT(*) AS count
            FROM decisions
            WHERE undone_at IS NULL
              AND action = 'matched'
              AND roster_child_id IS NOT NULL
            GROUP BY roster_child_id
            HAVING COUNT(*) > 1`
    },
    {
      label: "decisions referencing missing responses",
      sql: `SELECT d.response_id, COUNT(*) AS count
            FROM decisions d
            LEFT JOIN survey_responses s ON s.response_id = d.response_id
            WHERE s.response_id IS NULL
            GROUP BY d.response_id`
    },
    {
      label: "matched decisions referencing missing roster pupils",
      sql: `SELECT d.roster_child_id, COUNT(*) AS count
            FROM decisions d
            LEFT JOIN roster_children r ON r.roster_child_id = d.roster_child_id
            WHERE d.roster_child_id IS NOT NULL
              AND r.roster_child_id IS NULL
            GROUP BY d.roster_child_id`
    },
    {
      label: "candidates referencing missing responses",
      sql: `SELECT c.response_id, COUNT(*) AS count
            FROM candidates c
            LEFT JOIN survey_responses s ON s.response_id = c.response_id
            WHERE s.response_id IS NULL
            GROUP BY c.response_id`
    },
    {
      label: "candidates referencing missing roster pupils",
      sql: `SELECT c.roster_child_id, COUNT(*) AS count
            FROM candidates c
            LEFT JOIN roster_children r ON r.roster_child_id = c.roster_child_id
            WHERE r.roster_child_id IS NULL
            GROUP BY c.roster_child_id`
    }
  ];

  for (const check of checks) {
    const failures = rows(database, check.sql);
    if (failures.length) {
      throw new Error(`SQLite source has ${check.label}. First rows: ${JSON.stringify(failures.slice(0, 5))}`);
    }
  }
}

function applyWithPsql(args, applyPath) {
  if (!args.databaseUrl) {
    throw new Error("--apply requires --database-url or DATABASE_URL.");
  }

  const result = spawnSync("psql", [args.databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", applyPath], {
    cwd: appRoot,
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.error) {
    throw new Error(`Could not run psql. Install PostgreSQL client tools or apply ${applyPath} from a machine with psql. ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`psql failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.sqlite)) throw new Error(`SQLite source not found: ${args.sqlite}`);
  if (!fs.existsSync(args.schema)) throw new Error(`Postgres schema file not found: ${args.schema}`);

  const SQL = await initSqlJs({ locateFile: (file) => path.join(appRoot, "node_modules", "sql.js", "dist", file) });
  const database = new SQL.Database(fs.readFileSync(args.sqlite));

  assertNoSourceConflicts(database);

  const sourceRows = new Map();
  for (const spec of tableSpecs) {
    sourceRows.set(spec.name, readSourceRows(database, spec));
  }

  const sourceCounts = Object.fromEntries([...sourceRows.entries()].map(([table, tableRows]) => [table, tableRows.length]));
  fs.mkdirSync(args.out, { recursive: true });

  const migrationPath = path.join(args.out, "migration.sql");
  const verifyPath = path.join(args.out, "verify.sql");
  const applyPath = path.join(args.out, "apply.sql");
  const manifestPath = path.join(args.out, "source-counts.json");

  fs.writeFileSync(migrationPath, migrationSql(sourceRows, sourceCounts), "utf8");
  fs.writeFileSync(verifyPath, verifySql(sourceCounts), "utf8");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest(sourceRows, args), null, 2) + "\n", "utf8");
  fs.writeFileSync(
    applyPath,
    `${fs.readFileSync(args.schema, "utf8")}\n\n${fs.readFileSync(migrationPath, "utf8")}\n`,
    "utf8"
  );

  console.log(`Prepared migration bundle: ${args.out}`);
  console.log(JSON.stringify(sourceCounts, null, 2));

  if (args.apply) {
    const stdout = applyWithPsql(args, applyPath);
    if (stdout.trim()) console.log(stdout.trim());
    console.log("Postgres migration applied and count verification passed.");
  } else {
    console.log("Postgres not modified. Re-run with --apply and DATABASE_URL when the target database is ready.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
