import { app, BrowserWindow, dialog, ipcMain } from "electron";
import initSqlJs, { Database, SqlJsStatic, SqlValue } from "sql.js";
import { parse } from "csv-parse/sync";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type CsvRow = Record<string, string>;
type ExportRow = Record<string, unknown>;

type RecordDecisionPayload = {
  responseId: string;
  rosterChildId?: string;
  action: "matched" | "deferred" | "no_match" | "ambiguous" | "duplicate";
  note?: string;
};

type AddRosterStudentPayload = {
  schoolRaw: string;
  forenameRaw: string;
  surnameRaw: string;
  dobIso: string;
  sex?: string;
  upn?: string;
};

const PROCESSED_SURVEY_FILENAME = "deduped_survey_full_responses.csv";
const MATCH_CANDIDATES_FILENAME = "match_candidates.csv";
const REQUIRED_OUTPUT_FILES = ["normalized_roster.csv", PROCESSED_SURVEY_FILENAME, MATCH_CANDIDATES_FILENAME];
const PROCESSED_SURVEY_COLUMNS = new Set([
  "survey_row_index",
  "response_id",
  "start_date_raw",
  "end_date_raw",
  "recorded_date_raw",
  "status_raw",
  "progress",
  "duration_seconds",
  "finished",
  "consent_raw",
  "duplicate_respondent_raw",
  "entered_forename_raw",
  "entered_forename_norm",
  "entered_school_raw",
  "entered_school_norm",
  "birth_year_raw",
  "birth_month_raw",
  "birth_year",
  "birth_month",
  "birth_year_status",
  "birth_month_status",
  "birth_month_year",
  "response_class",
  "manual_identifier_decision",
  "dedupe_group_key",
  "dedupe_group_count",
  "dedupe_group_classification",
  "canonical_response_id",
  "is_canonical_response",
  "dedupe_decision",
  "duplicate_response_classification",
  "conflicting_answer_count_vs_canonical",
  "missing_answer_count_vs_canonical",
  "extra_answer_count_vs_canonical"
]);

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let dbPath = "";
let dataRoot = "";

if (process.env.MATCHER_USER_DATA_DIR) {
  app.setPath("userData", process.env.MATCHER_USER_DATA_DIR);
}

function locateSqlJsFile(file: string) {
  const candidates = [
    path.join(process.cwd(), "node_modules", "sql.js", "dist", file),
    path.join(app.getAppPath(), "node_modules", "sql.js", "dist", file),
    path.join(process.resourcesPath ?? "", "app.asar.unpacked", "node_modules", "sql.js", "dist", file),
    path.join(process.resourcesPath ?? "", "app", "node_modules", "sql.js", "dist", file)
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function readCsv(filePath: string): CsvRow[] {
  const text = fs.readFileSync(filePath, "utf8");
  return parse(text, {
    columns: true,
    bom: true,
    skip_empty_lines: false
  }) as CsvRow[];
}

function assertColumns(fileLabel: string, sampleRow: CsvRow | undefined, requiredColumns: string[]) {
  if (!sampleRow) {
    throw new Error(`${fileLabel} has no data rows.`);
  }
  const missing = requiredColumns.filter((column) => !(column in sampleRow));
  if (missing.length) {
    throw new Error(`${fileLabel} is missing required columns: ${missing.join(", ")}.`);
  }
}

function timestampForBackup() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function rows<T = Record<string, unknown>>(database: Database, sql: string, params: SqlValue[] = []): T[] {
  const stmt = database.prepare(sql);
  try {
    stmt.bind(params);
    const output: T[] = [];
    while (stmt.step()) {
      output.push(stmt.getAsObject() as T);
    }
    return output;
  } finally {
    stmt.free();
  }
}

function one<T = Record<string, unknown>>(database: Database, sql: string, params: SqlValue[] = []): T | null {
  return rows<T>(database, sql, params)[0] ?? null;
}

function run(database: Database, sql: string, params: SqlValue[] = []) {
  const stmt = database.prepare(sql);
  try {
    stmt.run(params);
  } finally {
    stmt.free();
  }
}

function saveDb() {
  if (!db || !dbPath) return;
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

function stableChildId(row: CsvRow): string {
  const parts = [
    row.roster_file ?? "",
    row.source_row ?? "",
    row.forename_raw ?? "",
    row.surname_raw ?? "",
    row.dob_iso ?? ""
  ];
  const digest = crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12);
  return `child_${digest}`;
}

function manualChildId(...parts: string[]): string {
  const seed = `${parts.join("|")}|${crypto.randomUUID()}`;
  const digest = crypto.createHash("sha1").update(seed).digest("hex").slice(0, 12);
  return `manual_${digest}`;
}

function validateDobIso(value: string) {
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    throw new Error("DOB must be entered as YYYY-MM-DD.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isValid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!isValid) {
    throw new Error("DOB is not a valid calendar date.");
  }
  if (year < 2008 || year > 2016) {
    throw new Error("DOB year is outside the expected pupil range.");
  }
  return {
    dobIso: text,
    birthMonth: String(month).padStart(2, "0"),
    birthYear: String(year)
  };
}

function hasRequiredOutputs(root: string) {
  const outputs = path.join(root, "outputs");
  return REQUIRED_OUTPUT_FILES.every((filename) => fs.existsSync(path.join(outputs, filename)));
}

function hasRequiredOutputFiles(outputsDir: string) {
  return REQUIRED_OUTPUT_FILES.every((filename) => fs.existsSync(path.join(outputsDir, filename)));
}

function findBundledOutputsDir() {
  const candidates = [
    path.join(process.resourcesPath ?? "", "outputs"),
    path.join(path.dirname(process.execPath), "resources", "outputs"),
    path.resolve(app.getAppPath(), "..", "outputs")
  ];
  return candidates.find((candidate) => hasRequiredOutputFiles(candidate)) ?? "";
}

function copyDirectoryContents(sourceDir: string, destinationDir: string) {
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function ensureInstalledDataRoot() {
  const userDataRoot = path.join(app.getPath("userData"), "matcher-data");
  if (hasRequiredOutputs(userDataRoot)) {
    return userDataRoot;
  }

  const bundledOutputs = findBundledOutputsDir();
  if (!bundledOutputs) {
    return "";
  }

  const destinationOutputs = path.join(userDataRoot, "outputs");
  copyDirectoryContents(bundledOutputs, destinationOutputs);
  return userDataRoot;
}

function findDataRoot(): string {
  const hasBundledOutputs = Boolean(findBundledOutputsDir());
  const shouldUsePackagedLookup = app.isPackaged || hasBundledOutputs;
  const starts = shouldUsePackagedLookup
    ? [path.dirname(process.execPath), process.cwd()].filter(Boolean)
    : [process.cwd(), path.dirname(process.execPath), app.getAppPath()].filter(Boolean);
  const maxDepth = shouldUsePackagedLookup ? 1 : 8;
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const start of starts) {
    let current = path.resolve(start);
    for (let depth = 0; depth < maxDepth; depth += 1) {
      for (const candidate of [current, path.resolve(current, "..")]) {
        if (!seen.has(candidate)) {
          seen.add(candidate);
          candidates.push(candidate);
        }
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  for (const candidateRoot of candidates) {
    if (hasRequiredOutputs(candidateRoot)) {
      return candidateRoot;
    }
  }

  const installedDataRoot = ensureInstalledDataRoot();
  if (installedDataRoot) {
    return installedDataRoot;
  }

  throw new Error("Could not find outputs directory with matcher CSV files.");
}

function getDb(): Database {
  if (!db) {
    throw new Error("Database has not been initialised.");
  }
  return db;
}

function createSchema(database: Database) {
  database.run(`
    CREATE TABLE IF NOT EXISTS roster_children (
      roster_child_id TEXT PRIMARY KEY,
      roster_file TEXT NOT NULL,
      school_raw TEXT,
      source_row INTEGER,
      forename_raw TEXT,
      surname_raw TEXT,
      dob_iso TEXT,
      birth_month TEXT,
      birth_year TEXT
    );

    CREATE TABLE IF NOT EXISTS roster_additions (
      roster_child_id TEXT PRIMARY KEY,
      school_raw TEXT NOT NULL,
      forename_raw TEXT NOT NULL,
      surname_raw TEXT NOT NULL,
      dob_iso TEXT NOT NULL,
      birth_month TEXT NOT NULL,
      birth_year TEXT NOT NULL,
      sex TEXT,
      upn TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS survey_responses (
      response_id TEXT PRIMARY KEY,
      survey_row_index INTEGER,
      entered_forename_raw TEXT,
      entered_school_raw TEXT,
      birth_month_year TEXT,
      progress INTEGER,
      finished TEXT,
      response_class TEXT,
      recorded_date_raw TEXT,
      dedupe_group_key TEXT,
      dedupe_decision TEXT,
      duplicate_response_classification TEXT,
      manual_identifier_decision TEXT
    );

    CREATE TABLE IF NOT EXISTS survey_response_full_rows (
      response_id TEXT PRIMARY KEY,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candidates (
      response_id TEXT NOT NULL,
      candidate_rank INTEGER NOT NULL,
      confidence TEXT,
      preselected TEXT,
      score REAL,
      top_gap REAL,
      school_score REAL,
      name_score REAL,
      dob_status TEXT,
      reason_codes TEXT,
      roster_child_id TEXT NOT NULL,
      roster_forename TEXT,
      roster_surname TEXT,
      roster_school TEXT,
      roster_birth_month_year TEXT,
      roster_dob_iso TEXT,
      PRIMARY KEY (response_id, candidate_rank)
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      response_id TEXT NOT NULL,
      roster_child_id TEXT,
      action TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      undone_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_decisions_active_response ON decisions(response_id, undone_at);
    CREATE INDEX IF NOT EXISTS idx_decisions_active_child ON decisions(roster_child_id, undone_at);
    CREATE INDEX IF NOT EXISTS idx_candidates_response ON candidates(response_id);
    CREATE INDEX IF NOT EXISTS idx_candidates_child ON candidates(roster_child_id);
    CREATE INDEX IF NOT EXISTS idx_roster_additions_school ON roster_additions(school_raw);
  `);
}

function insertRosterChild(
  database: Database,
  values: {
    rosterChildId: string;
    rosterFile: string;
    schoolRaw: string;
    sourceRow: number;
    forenameRaw: string;
    surnameRaw: string;
    dobIso: string;
    birthMonth: string;
    birthYear: string;
  }
) {
  run(
    database,
    `INSERT INTO roster_children (
      roster_child_id, roster_file, school_raw, source_row, forename_raw, surname_raw,
      dob_iso, birth_month, birth_year
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.rosterChildId,
      values.rosterFile,
      values.schoolRaw,
      values.sourceRow,
      values.forenameRaw,
      values.surnameRaw,
      values.dobIso,
      values.birthMonth,
      values.birthYear
    ]
  );
}

function applyRosterAdditions(database: Database) {
  const additions = rows<{
    roster_child_id: string;
    school_raw: string;
    forename_raw: string;
    surname_raw: string;
    dob_iso: string;
    birth_month: string;
    birth_year: string;
  }>(
    database,
    `SELECT roster_child_id, school_raw, forename_raw, surname_raw, dob_iso, birth_month, birth_year
     FROM roster_additions
     ORDER BY created_at ASC, roster_child_id ASC`
  );
  for (const addition of additions) {
    insertRosterChild(database, {
      rosterChildId: addition.roster_child_id,
      rosterFile: "Manual addition",
      schoolRaw: addition.school_raw,
      sourceRow: 0,
      forenameRaw: addition.forename_raw,
      surnameRaw: addition.surname_raw,
      dobIso: addition.dob_iso,
      birthMonth: addition.birth_month,
      birthYear: addition.birth_year
    });
  }
}

function importData(database: Database, root: string) {
  const outputs = path.join(root, "outputs");
  const rosterRows = readCsv(path.join(outputs, "normalized_roster.csv"));
  const surveyRows = readCsv(path.join(outputs, PROCESSED_SURVEY_FILENAME));
  const candidateRows = readCsv(path.join(outputs, "match_candidates.csv"));

  database.run("BEGIN TRANSACTION;");
  try {
    database.run("DELETE FROM roster_children; DELETE FROM survey_responses; DELETE FROM survey_response_full_rows; DELETE FROM candidates;");

    for (const row of rosterRows) {
      insertRosterChild(database, {
        rosterChildId: stableChildId(row),
        rosterFile: row.roster_file,
        schoolRaw: row.school_raw || row.school_from_filename || "",
        sourceRow: Number(row.source_row || 0),
        forenameRaw: row.forename_raw || "",
        surnameRaw: row.surname_raw || "",
        dobIso: row.dob_iso || "",
        birthMonth: row.birth_month || "",
        birthYear: row.birth_year || ""
      });
    }

    applyRosterAdditions(database);

    const activeSurveyIds = new Set<string>();
    for (const row of surveyRows) {
      if (row.is_canonical_response && row.is_canonical_response !== "true") {
        continue;
      }
      activeSurveyIds.add(row.response_id);
      run(
        database,
        `INSERT INTO survey_responses (
          response_id, survey_row_index, entered_forename_raw, entered_school_raw, birth_month_year,
          progress, finished, response_class, recorded_date_raw, dedupe_group_key, dedupe_decision,
          duplicate_response_classification, manual_identifier_decision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.response_id,
          Number(row.survey_row_index || 0),
          row.entered_forename_raw || "",
          row.entered_school_raw || "",
          row.birth_month_year || "",
          Number(row.progress || 0),
          row.finished || "",
          row.response_class || "",
          row.recorded_date_raw || "",
          row.dedupe_group_key || "",
          row.dedupe_decision || "",
          row.duplicate_response_classification || "",
          row.manual_identifier_decision || ""
        ]
      );
      run(
        database,
        `INSERT INTO survey_response_full_rows (response_id, raw_json)
         VALUES (?, ?)`,
        [row.response_id, JSON.stringify(row)]
      );
    }

    for (const row of candidateRows) {
      if (!activeSurveyIds.has(row.response_id)) {
        continue;
      }
      run(
        database,
        `INSERT INTO candidates (
          response_id, candidate_rank, confidence, preselected, score, top_gap, school_score,
          name_score, dob_status, reason_codes, roster_child_id, roster_forename, roster_surname,
          roster_school, roster_birth_month_year, roster_dob_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.response_id,
          Number(row.candidate_rank || 0),
          row.confidence || "",
          row.preselected || "",
          Number(row.score || 0),
          Number(row.top_gap || 0),
          Number(row.school_score || 0),
          Number(row.name_score || 0),
          row.dob_status || "",
          row.reason_codes || "",
          row.roster_child_id,
          row.roster_forename || "",
          row.roster_surname || "",
          row.roster_school || "",
          row.roster_birth_month_year || "",
          row.roster_dob_iso || ""
        ]
      );
    }
    database.run("COMMIT;");
  } catch (error) {
    database.run("ROLLBACK;");
    throw error;
  }
}

function validateProcessedSourceFolder(folderPath: string) {
  const surveyPath = path.join(folderPath, PROCESSED_SURVEY_FILENAME);
  const candidatesPath = path.join(folderPath, MATCH_CANDIDATES_FILENAME);
  if (!fs.existsSync(surveyPath)) {
    throw new Error(`Selected folder must contain ${PROCESSED_SURVEY_FILENAME}.`);
  }
  if (!fs.existsSync(candidatesPath)) {
    throw new Error(`Selected folder must contain ${MATCH_CANDIDATES_FILENAME}.`);
  }

  const surveyRows = readCsv(surveyPath);
  const candidateRows = readCsv(candidatesPath);
  assertColumns(PROCESSED_SURVEY_FILENAME, surveyRows[0], [
    "survey_row_index",
    "response_id",
    "recorded_date_raw",
    "progress",
    "finished",
    "entered_forename_raw",
    "entered_school_raw",
    "birth_month_year",
    "response_class",
    "dedupe_group_key",
    "dedupe_decision",
    "duplicate_response_classification",
    "manual_identifier_decision"
  ]);
  assertColumns(MATCH_CANDIDATES_FILENAME, candidateRows[0], [
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
  ]);

  const surveyIds = new Set(surveyRows.map((row) => row.response_id).filter(Boolean));
  const missingSurveyIds = [...new Set(candidateRows.map((row) => row.response_id).filter((responseId) => responseId && !surveyIds.has(responseId)))];
  if (missingSurveyIds.length) {
    throw new Error(`Candidate file references response IDs not present in ${PROCESSED_SURVEY_FILENAME}: ${missingSurveyIds.slice(0, 5).join(", ")}.`);
  }

  const rosterIds = new Set(rows<{ roster_child_id: string }>(getDb(), "SELECT roster_child_id FROM roster_children").map((row) => row.roster_child_id));
  const missingRosterIds = [...new Set(candidateRows.map((row) => row.roster_child_id).filter((childId) => childId && !rosterIds.has(childId)))];
  if (missingRosterIds.length) {
    throw new Error(`Candidate file references roster child IDs not present in this app's roster: ${missingRosterIds.slice(0, 5).join(", ")}.`);
  }

  return { surveyPath, candidatesPath, surveyRows, candidateRows };
}

async function importProcessedSourceFolder() {
  const selection = await dialog.showOpenDialog({
    title: "Select processed survey source folder",
    properties: ["openDirectory"]
  });
  if (selection.canceled || !selection.filePaths[0]) {
    return { ok: false, cancelled: true };
  }

  const folderPath = selection.filePaths[0];
  const validated = validateProcessedSourceFolder(folderPath);
  const outputs = path.join(dataRoot, "outputs");
  const backupDir = path.join(outputs, "import_backups", timestampForBackup());
  fs.mkdirSync(backupDir, { recursive: true });

  for (const filename of [PROCESSED_SURVEY_FILENAME, MATCH_CANDIDATES_FILENAME, "matcher_review.sqlite"]) {
    const sourcePath = path.join(outputs, filename);
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, path.join(backupDir, filename));
    }
  }

  fs.copyFileSync(validated.surveyPath, path.join(outputs, PROCESSED_SURVEY_FILENAME));
  fs.copyFileSync(validated.candidatesPath, path.join(outputs, MATCH_CANDIDATES_FILENAME));
  importData(getDb(), dataRoot);
  saveDb();

  return {
    ok: true,
    cancelled: false,
    sourceFolder: folderPath,
    backupDir,
    surveyRows: validated.surveyRows.length,
    candidateRows: validated.candidateRows.length,
    stats: getStats()
  };
}

function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsvFile(filePath: string, exportRows: ExportRow[], fieldnames: string[]) {
  const lines = [
    fieldnames.map(csvEscape).join(","),
    ...exportRows.map((row) => fieldnames.map((field) => csvEscape(row[field])).join(","))
  ];
  fs.writeFileSync(filePath, `\ufeff${lines.join("\r\n")}\r\n`, "utf8");
}

function parseFullSurveyRow(rawJson: string | null | undefined): CsvRow {
  if (!rawJson) return {};
  try {
    return JSON.parse(rawJson) as CsvRow;
  } catch {
    return {};
  }
}

function collectQualtricsFieldnames(fullRows: CsvRow[]) {
  const seen = new Set<string>();
  const fieldnames: string[] = [];
  for (const row of fullRows) {
    for (const field of Object.keys(row)) {
      if (!field || PROCESSED_SURVEY_COLUMNS.has(field) || seen.has(field)) continue;
      seen.add(field);
      fieldnames.push(field);
    }
  }
  return fieldnames;
}

function qualtricsExportColumn(field: string) {
  return `qualtrics__${field}`;
}

function buildMatchedSurveyResponseExport() {
  const matchedRows = rows<{
    decision_id: number;
    matched_at: string;
    response_id: string;
    roster_child_id: string;
    roster_school: string;
    roster_forename: string;
    roster_surname: string;
    roster_dob_iso: string;
    roster_birth_month: string;
    roster_birth_year: string;
    roster_file: string;
    roster_source_row: number;
    entered_forename_raw: string;
    entered_school_raw: string;
    survey_birth_month_year: string;
    progress: number;
    finished: string;
    response_class: string;
    recorded_date_raw: string;
    accepted_candidate_rank: number | null;
    accepted_confidence: string | null;
    accepted_score: number | null;
    accepted_school_score: number | null;
    accepted_name_score: number | null;
    accepted_reason_codes: string | null;
    raw_json: string | null;
  }>(
    getDb(),
    `SELECT
      d.id AS decision_id,
      d.created_at AS matched_at,
      d.response_id,
      r.roster_child_id,
      r.school_raw AS roster_school,
      r.forename_raw AS roster_forename,
      r.surname_raw AS roster_surname,
      r.dob_iso AS roster_dob_iso,
      r.birth_month AS roster_birth_month,
      r.birth_year AS roster_birth_year,
      r.roster_file,
      r.source_row AS roster_source_row,
      s.entered_forename_raw,
      s.entered_school_raw,
      s.birth_month_year AS survey_birth_month_year,
      s.progress,
      s.finished,
      s.response_class,
      s.recorded_date_raw,
      c.candidate_rank AS accepted_candidate_rank,
      c.confidence AS accepted_confidence,
      c.score AS accepted_score,
      c.school_score AS accepted_school_score,
      c.name_score AS accepted_name_score,
      c.reason_codes AS accepted_reason_codes,
      f.raw_json
     FROM decisions d
     JOIN survey_responses s ON s.response_id = d.response_id
     JOIN roster_children r ON r.roster_child_id = d.roster_child_id
     LEFT JOIN candidates c
       ON c.response_id = d.response_id
       AND c.roster_child_id = d.roster_child_id
     LEFT JOIN survey_response_full_rows f ON f.response_id = d.response_id
     WHERE d.undone_at IS NULL
       AND d.action = 'matched'
     ORDER BY r.school_raw, r.surname_raw, r.forename_raw, r.dob_iso, d.response_id`
  );

  const fullRows = matchedRows.map((row) => parseFullSurveyRow(row.raw_json));
  const qualtricsFields = collectQualtricsFieldnames(fullRows);
  const baseFieldnames = [
    "decision_id",
    "matched_at",
    "response_id",
    "roster_child_id",
    "roster_school",
    "roster_forename",
    "roster_surname",
    "roster_dob_iso",
    "roster_birth_month",
    "roster_birth_year",
    "roster_file",
    "roster_source_row",
    "entered_forename_raw",
    "entered_school_raw",
    "survey_birth_month_year",
    "progress",
    "finished",
    "response_class",
    "recorded_date_raw",
    "accepted_candidate_rank",
    "accepted_confidence",
    "accepted_score",
    "accepted_school_score",
    "accepted_name_score",
    "accepted_reason_codes"
  ];

  const exportRows = matchedRows.map((row, index) => {
    const exportRow: ExportRow = {};
    for (const field of baseFieldnames) {
      exportRow[field] = row[field as keyof typeof row];
    }
    const fullRow = fullRows[index];
    for (const field of qualtricsFields) {
      exportRow[qualtricsExportColumn(field)] = fullRow[field] ?? "";
    }
    return exportRow;
  });

  return {
    fieldnames: [...baseFieldnames, ...qualtricsFields.map(qualtricsExportColumn)],
    exportRows
  };
}

function buildRosterCoverageExport() {
  const coverageRows = rows<{
    roster_child_id: string;
    roster_school: string;
    roster_forename: string;
    roster_surname: string;
    roster_dob_iso: string;
    roster_birth_month: string;
    roster_birth_year: string;
    roster_file: string;
    roster_source_row: number;
    matched_response_id: string | null;
    matched_at: string | null;
    entered_forename_raw: string | null;
    entered_school_raw: string | null;
    survey_birth_month_year: string | null;
    survey_progress: number | null;
    survey_finished: string | null;
    survey_response_class: string | null;
    survey_recorded_date_raw: string | null;
    accepted_candidate_rank: number | null;
    accepted_confidence: string | null;
    accepted_score: number | null;
    accepted_school_score: number | null;
    accepted_name_score: number | null;
    accepted_reason_codes: string | null;
  }>(
    getDb(),
    `SELECT
      r.roster_child_id,
      r.school_raw AS roster_school,
      r.forename_raw AS roster_forename,
      r.surname_raw AS roster_surname,
      r.dob_iso AS roster_dob_iso,
      r.birth_month AS roster_birth_month,
      r.birth_year AS roster_birth_year,
      r.roster_file,
      r.source_row AS roster_source_row,
      d.response_id AS matched_response_id,
      d.created_at AS matched_at,
      s.entered_forename_raw,
      s.entered_school_raw,
      s.birth_month_year AS survey_birth_month_year,
      s.progress AS survey_progress,
      s.finished AS survey_finished,
      s.response_class AS survey_response_class,
      s.recorded_date_raw AS survey_recorded_date_raw,
      c.candidate_rank AS accepted_candidate_rank,
      c.confidence AS accepted_confidence,
      c.score AS accepted_score,
      c.school_score AS accepted_school_score,
      c.name_score AS accepted_name_score,
      c.reason_codes AS accepted_reason_codes
     FROM roster_children r
     LEFT JOIN decisions d
       ON d.roster_child_id = r.roster_child_id
       AND d.undone_at IS NULL
       AND d.action = 'matched'
       AND EXISTS (SELECT 1 FROM survey_responses active_s WHERE active_s.response_id = d.response_id)
     LEFT JOIN survey_responses s ON s.response_id = d.response_id
     LEFT JOIN candidates c
       ON c.response_id = d.response_id
       AND c.roster_child_id = d.roster_child_id
     ORDER BY r.school_raw, r.surname_raw, r.forename_raw, r.dob_iso, r.roster_child_id`
  );

  const fieldnames = [
    "roster_child_id",
    "roster_school",
    "roster_forename",
    "roster_surname",
    "roster_dob_iso",
    "roster_birth_month",
    "roster_birth_year",
    "roster_file",
    "roster_source_row",
    "match_status",
    "matched_response_id",
    "matched_at",
    "entered_forename_raw",
    "entered_school_raw",
    "survey_birth_month_year",
    "survey_progress",
    "survey_finished",
    "survey_response_class",
    "survey_recorded_date_raw",
    "accepted_candidate_rank",
    "accepted_confidence",
    "accepted_score",
    "accepted_school_score",
    "accepted_name_score",
    "accepted_reason_codes"
  ];
  const exportRows = coverageRows.map((row) => ({
    ...row,
    match_status: row.matched_response_id ? "matched" : "unmatched"
  }));

  return { fieldnames, exportRows };
}

async function exportMatchedSurveyResponses() {
  const selection = await dialog.showSaveDialog({
    title: "Export matched pupil survey data",
    defaultPath: path.join(dataRoot, "outputs", "matched_pupil_survey_export.csv"),
    filters: [{ name: "CSV", extensions: ["csv"] }]
  });
  if (selection.canceled || !selection.filePath) {
    return { ok: false, cancelled: true };
  }
  const exportData = buildMatchedSurveyResponseExport();
  writeCsvFile(selection.filePath, exportData.exportRows, exportData.fieldnames);
  return { ok: true, cancelled: false, filePath: selection.filePath, rows: exportData.exportRows.length };
}

async function exportRosterCoverage() {
  const selection = await dialog.showSaveDialog({
    title: "Export roster coverage",
    defaultPath: path.join(dataRoot, "outputs", "roster_coverage_export.csv"),
    filters: [{ name: "CSV", extensions: ["csv"] }]
  });
  if (selection.canceled || !selection.filePath) {
    return { ok: false, cancelled: true };
  }
  const exportData = buildRosterCoverageExport();
  writeCsvFile(selection.filePath, exportData.exportRows, exportData.fieldnames);
  return { ok: true, cancelled: false, filePath: selection.filePath, rows: exportData.exportRows.length };
}

async function initDatabase() {
  dataRoot = findDataRoot();
  dbPath = path.join(dataRoot, "outputs", "matcher_review.sqlite");

  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: locateSqlJsFile
    });
  }

  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }
  createSchema(db);
  importData(db, dataRoot);
  saveDb();
  return { dataRoot, dbPath };
}

function reviewableWhere() {
  return `s.response_class NOT IN ('non_consent', 'low_progress_no_pupil_identifiers', 'no_pupil_identifiers')`;
}

function countSql(database: Database, sql: string, params: SqlValue[] = []) {
  return Number((one<{ count: number }>(database, sql, params)?.count ?? 0));
}

function getStats() {
  const database = getDb();
  const responseCount = countSql(database, "SELECT COUNT(*) AS count FROM survey_responses");
  const reviewable = countSql(database, `SELECT COUNT(*) AS count FROM survey_responses s WHERE ${reviewableWhere()}`);
  const activeDecisionCount = (action?: string) =>
    countSql(
      database,
      `SELECT COUNT(DISTINCT d.response_id) AS count
       FROM decisions d
       JOIN survey_responses s ON s.response_id = d.response_id
       WHERE d.undone_at IS NULL
       ${action ? "AND d.action = ?" : ""}`,
      action ? [action] : []
    );
  const matched = activeDecisionCount("matched");
  const deferred = activeDecisionCount("deferred");
  const noMatch = activeDecisionCount("no_match");
  const ambiguous = activeDecisionCount("ambiguous");
  const duplicate = activeDecisionCount("duplicate");
  const activeDecisions = activeDecisionCount();
  const preselected = countSql(database, "SELECT COUNT(DISTINCT response_id) AS count FROM candidates WHERE preselected = 'true'");
  const noCandidate = countSql(
    database,
    `SELECT COUNT(*) AS count
     FROM survey_responses s
     WHERE ${reviewableWhere()}
       AND NOT EXISTS (SELECT 1 FROM candidates c WHERE c.response_id = s.response_id)`
  );
  return {
    responseCount,
    reviewable,
    unreviewed: Math.max(0, reviewable - activeDecisions),
    matched,
    deferred,
    noMatch,
    ambiguous,
    duplicate,
    preselected,
    noCandidate,
    rosterChildren: countSql(database, "SELECT COUNT(*) AS count FROM roster_children")
  };
}

function candidateOrderCase() {
  return `
    CASE COALESCE((SELECT confidence FROM candidates c WHERE c.response_id = s.response_id AND c.candidate_rank = 1), 'no_candidate')
      WHEN 'high_preselect' THEN 0
      WHEN 'medium_review' THEN 1
      WHEN 'low_review' THEN 2
      ELSE 3
    END
  `;
}

function getNextResponse(queue: string) {
  const database = getDb();
  const baseSelect = `
    SELECT s.*,
      (SELECT COUNT(*) FROM candidates c WHERE c.response_id = s.response_id) AS candidate_count,
      COALESCE((SELECT confidence FROM candidates c WHERE c.response_id = s.response_id AND c.candidate_rank = 1), 'no_candidate') AS top_confidence
    FROM survey_responses s
  `;
  if (queue === "deferred") {
    return one(
      database,
      `${baseSelect}
       JOIN decisions d ON d.response_id = s.response_id AND d.undone_at IS NULL AND d.action = 'deferred'
       WHERE ${reviewableWhere()}
       ORDER BY d.created_at ASC
       LIMIT 1`
    );
  }
  if (queue === "ambiguous") {
    return one(
      database,
      `${baseSelect}
       JOIN decisions d ON d.response_id = s.response_id AND d.undone_at IS NULL AND d.action = 'ambiguous'
       WHERE ${reviewableWhere()}
       ORDER BY d.created_at ASC
       LIMIT 1`
    );
  }
  if (queue === "duplicate") {
    return one(
      database,
      `${baseSelect}
       JOIN decisions d ON d.response_id = s.response_id AND d.undone_at IS NULL AND d.action = 'duplicate'
       WHERE ${reviewableWhere()}
       ORDER BY d.created_at ASC
       LIMIT 1`
    );
  }
  return one(
    database,
    `${baseSelect}
     WHERE ${reviewableWhere()}
       AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.response_id = s.response_id AND d.undone_at IS NULL)
     ORDER BY ${candidateOrderCase()}, s.recorded_date_raw ASC, s.response_id ASC
     LIMIT 1`
  );
}

function getCandidates(responseId: string) {
  return rows(
    getDb(),
    `SELECT c.*,
      d.response_id AS matched_response_id,
      d.id AS matched_decision_id
     FROM candidates c
     LEFT JOIN decisions d
       ON d.roster_child_id = c.roster_child_id
       AND d.undone_at IS NULL
       AND d.action = 'matched'
       AND EXISTS (SELECT 1 FROM survey_responses active_s WHERE active_s.response_id = d.response_id)
     WHERE c.response_id = ?
     ORDER BY c.candidate_rank ASC`,
    [responseId]
  );
}

function recordDecision(payload: RecordDecisionPayload) {
  const database = getDb();
  const now = new Date().toISOString();
  const currentResponse = one<{ response_id: string }>(
    database,
    "SELECT response_id FROM survey_responses WHERE response_id = ?",
    [payload.responseId]
  );
  if (!currentResponse) {
    throw new Error("Response was not found in the active survey data.");
  }
  if (payload.action === "matched") {
    if (!payload.rosterChildId) {
      throw new Error("A matched decision requires a roster child.");
    }
    const existing = one<{ response_id: string }>(
      database,
      `SELECT decisions.response_id
       FROM decisions
       WHERE decisions.roster_child_id = ?
         AND decisions.undone_at IS NULL
         AND decisions.action = 'matched'
         AND decisions.response_id <> ?
       LIMIT 1`,
      [payload.rosterChildId, payload.responseId]
    );
    if (existing) {
      throw new Error(`This pupil is already matched to response ${existing.response_id}. Use Duplicate response if this is another submission from the same pupil.`);
    }
  }

  database.run("BEGIN TRANSACTION;");
  try {
    run(database, "UPDATE decisions SET undone_at = ? WHERE response_id = ? AND undone_at IS NULL", [now, payload.responseId]);
    run(
      database,
      `INSERT INTO decisions (response_id, roster_child_id, action, note, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [payload.responseId, payload.rosterChildId ?? null, payload.action, payload.note ?? "", now]
    );
    database.run("COMMIT;");
    saveDb();
  } catch (error) {
    database.run("ROLLBACK;");
    throw error;
  }
  return { ok: true };
}

function undoLast() {
  const database = getDb();
  const last = one<{ id: number; action: string; response_id: string }>(
    database,
    `SELECT decisions.id, decisions.action, decisions.response_id
     FROM decisions
     JOIN survey_responses s ON s.response_id = decisions.response_id
     WHERE undone_at IS NULL
     ORDER BY id DESC
     LIMIT 1`
  );
  if (!last) {
    return { ok: false, message: "No active decision to undo." };
  }
  run(database, "UPDATE decisions SET undone_at = ? WHERE id = ?", [new Date().toISOString(), last.id]);
  saveDb();
  return { ok: true, undone: last };
}

function undoDecision(decisionId: number) {
  const database = getDb();
  const activeDecision = one<{ id: number; action: string; response_id: string }>(
    database,
    `SELECT id, action, response_id
     FROM decisions
     WHERE id = ?
       AND undone_at IS NULL
     LIMIT 1`,
    [decisionId]
  );
  if (!activeDecision) {
    return { ok: false, message: "Decision is no longer active." };
  }
  run(database, "UPDATE decisions SET undone_at = ? WHERE id = ?", [new Date().toISOString(), decisionId]);
  saveDb();
  return { ok: true, undone: activeDecision };
}

function getReviewedRecords() {
  return rows(
    getDb(),
    `SELECT
      d.id AS decision_id,
      d.response_id,
      d.roster_child_id,
      d.action,
      d.note,
      d.created_at AS decided_at,
      s.survey_row_index,
      s.entered_forename_raw,
      s.entered_school_raw,
      s.birth_month_year,
      s.progress,
      s.finished,
      s.response_class,
      s.recorded_date_raw,
      s.dedupe_group_key,
      r.forename_raw AS roster_forename,
      r.surname_raw AS roster_surname,
      r.school_raw AS roster_school,
      r.dob_iso AS roster_dob_iso,
      r.birth_month AS roster_birth_month,
      r.birth_year AS roster_birth_year,
      c.candidate_rank AS accepted_candidate_rank,
      c.confidence AS accepted_confidence,
      c.score AS accepted_score,
      c.school_score AS accepted_school_score,
      c.name_score AS accepted_name_score,
      c.reason_codes AS accepted_reason_codes,
      COALESCE((SELECT COUNT(*) FROM candidates candidate_counts WHERE candidate_counts.response_id = s.response_id), 0) AS candidate_count,
      COALESCE((
        SELECT top_candidate.confidence
        FROM candidates top_candidate
        WHERE top_candidate.response_id = s.response_id
        ORDER BY top_candidate.candidate_rank ASC
        LIMIT 1
      ), 'no_candidate') AS top_confidence
     FROM decisions d
     JOIN survey_responses s ON s.response_id = d.response_id
     LEFT JOIN roster_children r ON r.roster_child_id = d.roster_child_id
     LEFT JOIN candidates c
       ON c.response_id = d.response_id
       AND c.roster_child_id = d.roster_child_id
     WHERE d.undone_at IS NULL
     ORDER BY d.created_at DESC, d.id DESC`
  );
}

function getSchools() {
  return rows(
    getDb(),
    `SELECT school_raw, COUNT(*) AS roster_count
     FROM roster_children
     WHERE TRIM(COALESCE(school_raw, '')) <> ''
     GROUP BY school_raw
     ORDER BY school_raw`
  );
}

function addRosterStudent(payload: AddRosterStudentPayload) {
  const database = getDb();
  const schoolRaw = payload.schoolRaw.trim();
  const forenameRaw = payload.forenameRaw.trim();
  const surnameRaw = payload.surnameRaw.trim();
  const sex = (payload.sex ?? "").trim();
  const upn = (payload.upn ?? "").trim();
  if (!schoolRaw) throw new Error("School is required.");
  if (!forenameRaw) throw new Error("Forename is required.");
  if (!surnameRaw) throw new Error("Surname is required.");
  const dob = validateDobIso(payload.dobIso);

  const duplicate = one<{ roster_child_id: string }>(
    database,
    `SELECT roster_child_id
     FROM roster_children
     WHERE lower(school_raw) = lower(?)
       AND lower(forename_raw) = lower(?)
       AND lower(surname_raw) = lower(?)
       AND dob_iso = ?
     LIMIT 1`,
    [schoolRaw, forenameRaw, surnameRaw, dob.dobIso]
  );
  if (duplicate) {
    throw new Error("A roster pupil with those exact details already exists.");
  }

  const rosterChildId = manualChildId(schoolRaw, forenameRaw, surnameRaw, dob.dobIso);
  const now = new Date().toISOString();
  database.run("BEGIN TRANSACTION;");
  try {
    run(
      database,
      `INSERT INTO roster_additions (
        roster_child_id, school_raw, forename_raw, surname_raw, dob_iso,
        birth_month, birth_year, sex, upn, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rosterChildId,
        schoolRaw,
        forenameRaw,
        surnameRaw,
        dob.dobIso,
        dob.birthMonth,
        dob.birthYear,
        sex,
        upn,
        now
      ]
    );
    insertRosterChild(database, {
      rosterChildId,
      rosterFile: "Manual addition",
      schoolRaw,
      sourceRow: 0,
      forenameRaw,
      surnameRaw,
      dobIso: dob.dobIso,
      birthMonth: dob.birthMonth,
      birthYear: dob.birthYear
    });
    database.run("COMMIT;");
    saveDb();
  } catch (error) {
    database.run("ROLLBACK;");
    throw error;
  }

  return {
    roster_child_id: rosterChildId,
    roster_file: "Manual addition",
    school_raw: schoolRaw,
    source_row: 0,
    forename_raw: forenameRaw,
    surname_raw: surnameRaw,
    dob_iso: dob.dobIso,
    birth_month: dob.birthMonth,
    birth_year: dob.birthYear
  };
}

function searchRoster(query: string) {
  const q = `%${query.trim().toLowerCase()}%`;
  if (query.trim().length < 2) return [];
  return rows(
    getDb(),
    `SELECT r.*,
      d.response_id AS matched_response_id
     FROM roster_children r
     LEFT JOIN decisions d
       ON d.roster_child_id = r.roster_child_id
       AND d.undone_at IS NULL
       AND d.action = 'matched'
       AND EXISTS (SELECT 1 FROM survey_responses active_s WHERE active_s.response_id = d.response_id)
     WHERE lower(r.forename_raw || ' ' || r.surname_raw || ' ' || r.school_raw || ' ' || r.dob_iso) LIKE ?
     ORDER BY r.school_raw, r.surname_raw, r.forename_raw
     LIMIT 50`,
    [q]
  );
}

function getRosterCoverage() {
  return rows(
    getDb(),
    `SELECT r.school_raw,
      COUNT(*) AS roster_count,
      SUM(CASE WHEN d.id IS NULL THEN 0 ELSE 1 END) AS matched_count
     FROM roster_children r
     LEFT JOIN decisions d
       ON d.roster_child_id = r.roster_child_id
       AND d.undone_at IS NULL
       AND d.action = 'matched'
       AND EXISTS (SELECT 1 FROM survey_responses active_s WHERE active_s.response_id = d.response_id)
     GROUP BY r.school_raw
     ORDER BY r.school_raw`
  );
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#f7f6f2",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (!app.isPackaged) {
    win.loadURL("http://127.0.0.1:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

ipcMain.handle("matcher:init", () => initDatabase());
ipcMain.handle("matcher:getStats", () => getStats());
ipcMain.handle("matcher:getNextResponse", (_event, queue: string) => getNextResponse(queue));
ipcMain.handle("matcher:getCandidates", (_event, responseId: string) => getCandidates(responseId));
ipcMain.handle("matcher:recordDecision", (_event, payload: RecordDecisionPayload) => recordDecision(payload));
ipcMain.handle("matcher:undoLast", () => undoLast());
ipcMain.handle("matcher:undoDecision", (_event, decisionId: number) => undoDecision(decisionId));
ipcMain.handle("matcher:searchRoster", (_event, query: string) => searchRoster(query));
ipcMain.handle("matcher:getRosterCoverage", () => getRosterCoverage());
ipcMain.handle("matcher:getReviewedRecords", () => getReviewedRecords());
ipcMain.handle("matcher:getSchools", () => getSchools());
ipcMain.handle("matcher:addRosterStudent", (_event, payload: AddRosterStudentPayload) => addRosterStudent(payload));
ipcMain.handle("matcher:importProcessedSourceFolder", () => importProcessedSourceFolder());
ipcMain.handle("matcher:exportMatchedSurveyResponses", () => exportMatchedSurveyResponses());
ipcMain.handle("matcher:exportRosterCoverage", () => exportRosterCoverage());

app.whenReady().then(async () => {
  await initDatabase();
  if (process.env.MATCHER_SMOKE === "1") {
    console.log(
      JSON.stringify(
        {
          ...getStats(),
          reviewedRecords: getReviewedRecords().length,
          manualRosterAdditions: countSql(getDb(), "SELECT COUNT(*) AS count FROM roster_additions"),
          fullSurveyRows: countSql(getDb(), "SELECT COUNT(*) AS count FROM survey_response_full_rows"),
          matchedExportRows: buildMatchedSurveyResponseExport().exportRows.length,
          rosterCoverageRows: buildRosterCoverageExport().exportRows.length
        },
        null,
        2
      )
    );
    app.quit();
    return;
  }
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
