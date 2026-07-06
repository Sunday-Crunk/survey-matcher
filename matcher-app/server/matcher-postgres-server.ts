import { parse } from "csv-parse/sync";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { AddRosterStudentPayload, RecordDecisionPayload } from "../src/types";

type CsvRow = Record<string, string>;
type ExportRow = Record<string, unknown>;
type AuthUser = { id: number; username: string; display_name: string };
type RequestContext = { user: AuthUser };
type PgDatabase = Pool | PoolClient;
type SqlValue = string | number | boolean | null | Date;

const appRoot = path.resolve(__dirname, "..");
const distDir = path.join(appRoot, "dist");
const seedOutputsDir = path.join(appRoot, "seed-outputs");
const workspaceRoot = path.resolve(appRoot, "..");
const scriptsDir = path.join(workspaceRoot, "scripts");
const dataRoot = process.env.MATCHER_DATA_ROOT
  ? path.resolve(process.env.MATCHER_DATA_ROOT)
  : path.join(appRoot, "web-data");
const outputsDir = path.join(dataRoot, "outputs");
const dbPath = path.join(outputsDir, "matcher_review.sqlite");
const schemaPath = path.join(appRoot, "db", "hosted-postgres-schema.sql");
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "0.0.0.0";
const sessionCookieName = "matcher_session";
const sessionDurationMs = 1000 * 60 * 60 * 24 * 7;
const hostedMode = Boolean(process.env.DATABASE_URL || process.env.RENDER || process.env.NODE_ENV === "production");
const secureCookies = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : hostedMode;
const processedSurveyColumns = new Set([
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

let pool: Pool | null = null;
const execFileAsync = promisify(execFile);

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

function toPostgresSql(sql: string) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function normalizePgValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizePgRow<T>(row: QueryResultRow): T {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizePgValue(value)])) as T;
}

async function rows<T = Record<string, unknown>>(database: PgDatabase, sql: string, params: SqlValue[] = []): Promise<T[]> {
  const result = await database.query(toPostgresSql(sql), params);
  return result.rows.map(normalizePgRow<T>);
}

async function one<T = Record<string, unknown>>(database: PgDatabase, sql: string, params: SqlValue[] = []): Promise<T | null> {
  return (await rows<T>(database, sql, params))[0] ?? null;
}

async function run(database: PgDatabase, sql: string, params: SqlValue[] = []) {
  await database.query(toPostgresSql(sql), params);
}

async function transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDb().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

function hashValue(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const key = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${key}`;
}

function verifyPassword(password: string, storedHash: string) {
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expectedHex] = parts;
  const actual = Buffer.from(crypto.scryptSync(password, salt, 64).toString("hex"), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function currentUserLabel(user: AuthUser) {
  return user.display_name || user.username;
}

function readCsv(filePath: string): CsvRow[] {
  const text = fs.readFileSync(filePath, "utf8");
  return parse(text, {
    columns: true,
    bom: true,
    skip_empty_lines: false
  }) as CsvRow[];
}

function getDb(): Pool {
  if (!pool) throw new Error("Database has not been initialised.");
  return pool;
}

function saveDb() {
  return;
}

async function createSchema(database: PgDatabase) {
  await database.query(fs.readFileSync(schemaPath, "utf8"));
}

async function ensureBootstrapUser(database: PgDatabase) {
  const userCount = await countSql(database, "SELECT COUNT(*) AS count FROM app_users");
  if (userCount > 0) return;

  const username = (process.env.MATCHER_BOOTSTRAP_USERNAME || "admin").trim();
  const displayName = (process.env.MATCHER_BOOTSTRAP_DISPLAY_NAME || username).trim();
  const password = process.env.MATCHER_BOOTSTRAP_PASSWORD || (hostedMode ? "" : "matcher-dev");

  if (!password) {
    throw new Error("No users exist. Set MATCHER_BOOTSTRAP_USERNAME and MATCHER_BOOTSTRAP_PASSWORD before starting the hosted app.");
  }

  await run(
    database,
    `INSERT INTO app_users (username, display_name, password_hash, created_at)
     VALUES (?, ?, ?, ?)`,
    [username, displayName, hashPassword(password), new Date().toISOString()]
  );

  if (!hostedMode && !process.env.MATCHER_BOOTSTRAP_PASSWORD) {
    console.log("Created local development user admin / matcher-dev");
  }
}

function parseCookies(header: string | string[] | undefined) {
  const cookieHeader = Array.isArray(header) ? header.join(";") : header ?? "";
  const cookies = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) continue;
    cookies.set(rawName, decodeURIComponent(rawValue.join("=")));
  }
  return cookies;
}

function sessionCookie(value: string, expiresAt: Date) {
  return [
    `${sessionCookieName}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))}`,
    secureCookies ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

function clearSessionCookie() {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies ? "; Secure" : ""}`;
}

async function getRequestUser(request: http.IncomingMessage): Promise<AuthUser | null> {
  const token = parseCookies(request.headers.cookie).get(sessionCookieName);
  if (!token) return null;
  const now = new Date().toISOString();
  return one<AuthUser>(
    getDb(),
    `SELECT u.id, u.username, u.display_name
     FROM app_sessions s
     JOIN app_users u ON u.id = s.user_id
     WHERE s.token_hash = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > ?
       AND u.disabled_at IS NULL
     LIMIT 1`,
    [hashValue(token), now]
  );
}

async function requireUser(request: http.IncomingMessage): Promise<RequestContext> {
  const user = await getRequestUser(request);
  if (!user) throw new ApiError(401, "Sign in to continue.");
  return { user };
}

async function loginUser(username: string, password: string, response: http.ServerResponse) {
  const user = await one<AuthUser & { password_hash: string }>(
    getDb(),
    `SELECT id, username, display_name, password_hash
     FROM app_users
     WHERE lower(username) = lower(?)
       AND disabled_at IS NULL
     LIMIT 1`,
    [username.trim()]
  );

  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new ApiError(401, "Username or password is incorrect.");
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionDurationMs);
  await run(
    getDb(),
    `INSERT INTO app_sessions (token_hash, user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?)`,
    [hashValue(token), user.id, now.toISOString(), expiresAt.toISOString()]
  );
  response.setHeader("Set-Cookie", sessionCookie(token, expiresAt));
  return { ok: true, user: { id: user.id, username: user.username, displayName: user.display_name } };
}

async function logoutUser(request: http.IncomingMessage, response: http.ServerResponse) {
  const token = parseCookies(request.headers.cookie).get(sessionCookieName);
  if (token) {
    await run(getDb(), "UPDATE app_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL", [
      new Date().toISOString(),
      hashValue(token)
    ]);
  }
  response.setHeader("Set-Cookie", clearSessionCookie());
  return { ok: true };
}

function publicUser(user: AuthUser | null) {
  return user ? { id: user.id, username: user.username, displayName: user.display_name } : null;
}

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for the Postgres web server.");
  }
  fs.mkdirSync(outputsDir, { recursive: true });
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PGPOOL_MAX ?? 10),
    ssl: process.env.PGSSLMODE === "disable" ? false : undefined
  });
  await createSchema(pool);
  await ensureBootstrapUser(pool);
  return { dataRoot, dbPath: "postgres" };
}

function reviewableWhere() {
  return `s.response_class NOT IN ('non_consent', 'low_progress_no_pupil_identifiers', 'no_pupil_identifiers')`;
}

async function countSql(database: PgDatabase, sql: string, params: SqlValue[] = []) {
  return Number((await one<{ count: number }>(database, sql, params))?.count ?? 0);
}

async function getStats() {
  const database = getDb();
  const responseCount = await countSql(database, "SELECT COUNT(*) AS count FROM survey_responses");
  const reviewable = await countSql(database, `SELECT COUNT(*) AS count FROM survey_responses s WHERE ${reviewableWhere()}`);
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
  const matched = await activeDecisionCount("matched");
  const deferred = await activeDecisionCount("deferred");
  const noMatch = await activeDecisionCount("no_match");
  const ambiguous = await activeDecisionCount("ambiguous");
  const duplicate = await activeDecisionCount("duplicate");
  const activeDecisions = await activeDecisionCount();
  const preselected = await countSql(database, "SELECT COUNT(DISTINCT response_id) AS count FROM candidates WHERE preselected = 'true'");
  const noCandidate = await countSql(
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
    rosterChildren: await countSql(database, "SELECT COUNT(*) AS count FROM roster_children")
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

async function getNextResponse(queue: string) {
  const database = getDb();
  const baseSelect = `
    SELECT s.*,
      (SELECT COUNT(*) FROM candidates c WHERE c.response_id = s.response_id) AS candidate_count,
      COALESCE((SELECT confidence FROM candidates c WHERE c.response_id = s.response_id AND c.candidate_rank = 1), 'no_candidate') AS top_confidence,
      (SELECT active_decision.id FROM decisions active_decision WHERE active_decision.response_id = s.response_id AND active_decision.undone_at IS NULL LIMIT 1) AS active_decision_id,
      (SELECT active_decision.action FROM decisions active_decision WHERE active_decision.response_id = s.response_id AND active_decision.undone_at IS NULL LIMIT 1) AS active_decision_action
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

async function getCandidates(responseId: string) {
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

async function recordAuditEvent(
  database: PgDatabase,
  values: {
    eventType: string;
    actor: string;
    subject: string;
    detail: string;
    responseId?: string | null;
    rosterChildId?: string | null;
    occurredAt?: string;
  }
) {
  await run(
    database,
    `INSERT INTO audit_events (event_type, occurred_at, actor, subject, detail, response_id, roster_child_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      values.eventType,
      values.occurredAt ?? new Date().toISOString(),
      values.actor,
      values.subject,
      values.detail,
      values.responseId ?? null,
      values.rosterChildId ?? null
    ]
  );
}

async function recordDecision(payload: RecordDecisionPayload, context: RequestContext) {
  const now = new Date().toISOString();
  if (payload.action === "matched" && !payload.rosterChildId) {
    throw new ApiError(400, "A matched decision requires a roster child.");
  }

  try {
    await transaction(async (database) => {
    const currentResponse = await one<{ response_id: string }>(
      database,
      "SELECT response_id FROM survey_responses WHERE response_id = ?",
      [payload.responseId]
    );
    if (!currentResponse) throw new ApiError(404, "Response was not found in the active survey data.");

    const activeDecision = await one<{ id: number; action: string; created_by: string | null }>(
      database,
      `SELECT id, action, created_by
       FROM decisions
       WHERE response_id = ?
         AND undone_at IS NULL
       LIMIT 1`,
      [payload.responseId]
    );

    if (activeDecision && activeDecision.id !== payload.revisesDecisionId) {
      throw new ApiError(
        409,
        `This response has already been decided by ${activeDecision.created_by || "another user"}. Refresh the queue before continuing.`
      );
    }

    if (!activeDecision && payload.revisesDecisionId) {
      throw new ApiError(409, "This response was already changed by another user. Refresh the queue before continuing.");
    }

    if (payload.action === "matched") {
      const existing = await one<{ response_id: string; created_by: string | null }>(
        database,
        `SELECT decisions.response_id, decisions.created_by
         FROM decisions
         WHERE decisions.roster_child_id = ?
           AND decisions.undone_at IS NULL
           AND decisions.action = 'matched'
           AND decisions.response_id <> ?
         LIMIT 1`,
        [payload.rosterChildId ?? null, payload.responseId]
      );
      if (existing) {
        throw new ApiError(
          409,
          `This pupil is already matched to response ${existing.response_id} by ${existing.created_by || "another user"}. Refresh before continuing.`
        );
      }
    }

    if (activeDecision) {
      await run(database, "UPDATE decisions SET undone_at = ?, undone_by = ? WHERE id = ?", [
        now,
        currentUserLabel(context.user),
        activeDecision.id
      ]);
    }

    await run(
      database,
      `INSERT INTO decisions (response_id, roster_child_id, action, note, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [payload.responseId, payload.rosterChildId ?? null, payload.action, payload.note ?? "", now, currentUserLabel(context.user)]
    );
    await recordAuditEvent(database, {
      eventType: activeDecision ? "decision_revised" : "decision_recorded",
      actor: currentUserLabel(context.user),
      subject: payload.action,
      detail: `${activeDecision ? "Decision revised" : "Decision recorded"} for response ${payload.responseId}`,
      responseId: payload.responseId,
      rosterChildId: payload.rosterChildId ?? null,
      occurredAt: now
    });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError(409, "This response or pupil was already decided by another user. Refresh before continuing.");
    }
    throw error;
  }
  return { ok: true };
}

async function undoLast(context: RequestContext) {
  const now = new Date().toISOString();
  return transaction(async (database) => {
    const last = await one<{ id: number; action: string; response_id: string; roster_child_id: string | null }>(
      database,
      `SELECT decisions.id, decisions.action, decisions.response_id, decisions.roster_child_id
       FROM decisions
       JOIN survey_responses s ON s.response_id = decisions.response_id
       WHERE undone_at IS NULL
       ORDER BY id DESC
       LIMIT 1`
    );
    if (!last) {
      return { ok: false, message: "No active decision to undo." };
    }
    await run(database, "UPDATE decisions SET undone_at = ?, undone_by = ? WHERE id = ?", [
      now,
      currentUserLabel(context.user),
      last.id
    ]);
    await recordAuditEvent(database, {
      eventType: "decision_reopened",
      actor: currentUserLabel(context.user),
      subject: last.action,
      detail: `Decision reopened for response ${last.response_id}`,
      responseId: last.response_id,
      rosterChildId: last.roster_child_id,
      occurredAt: now
    });
    return { ok: true };
  });
}

async function undoDecision(decisionId: number, context: RequestContext) {
  const now = new Date().toISOString();
  return transaction(async (database) => {
    const activeDecision = await one<{ id: number; action: string; response_id: string; roster_child_id: string | null }>(
      database,
      `SELECT id, action, response_id, roster_child_id
       FROM decisions
       WHERE id = ?
         AND undone_at IS NULL
       LIMIT 1`,
      [decisionId]
    );
    if (!activeDecision) {
      return { ok: false, message: "Decision is no longer active." };
    }
    await run(database, "UPDATE decisions SET undone_at = ?, undone_by = ? WHERE id = ?", [
      now,
      currentUserLabel(context.user),
      decisionId
    ]);
    await recordAuditEvent(database, {
      eventType: "decision_reopened",
      actor: currentUserLabel(context.user),
      subject: activeDecision.action,
      detail: `Decision reopened for response ${activeDecision.response_id}`,
      responseId: activeDecision.response_id,
      rosterChildId: activeDecision.roster_child_id,
      occurredAt: now
    });
    return { ok: true, undone: activeDecision };
  });
}

async function getReviewedRecords() {
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

async function getPupils() {
  return rows(
    getDb(),
    `SELECT
      r.roster_child_id,
      r.roster_file,
      r.school_raw,
      r.source_row,
      r.forename_raw,
      r.surname_raw,
      r.dob_iso,
      r.birth_month,
      r.birth_year,
      CASE WHEN d.id IS NULL THEN 'available' ELSE 'matched' END AS status,
      d.response_id AS matched_response_id,
      d.id AS matched_decision_id,
      d.created_at AS matched_at,
      COALESCE((SELECT COUNT(*) FROM candidates c WHERE c.roster_child_id = r.roster_child_id), 0) AS candidate_count
     FROM roster_children r
     LEFT JOIN decisions d
       ON d.roster_child_id = r.roster_child_id
       AND d.undone_at IS NULL
       AND d.action = 'matched'
       AND EXISTS (SELECT 1 FROM survey_responses active_s WHERE active_s.response_id = d.response_id)
     ORDER BY r.school_raw, r.surname_raw, r.forename_raw, r.dob_iso, r.roster_child_id`
  );
}

async function getResponses() {
  return rows(
    getDb(),
    `SELECT s.*,
      COALESCE((SELECT COUNT(*) FROM candidates c WHERE c.response_id = s.response_id), 0) AS candidate_count,
      COALESCE((
        SELECT top_candidate.confidence
        FROM candidates top_candidate
        WHERE top_candidate.response_id = s.response_id
        ORDER BY top_candidate.candidate_rank ASC
        LIMIT 1
      ), 'no_candidate') AS top_confidence,
      COALESCE(d.action, 'unreviewed') AS status,
      d.id AS decision_id,
      d.created_at AS decided_at,
      d.roster_child_id,
      r.forename_raw AS roster_forename,
      r.surname_raw AS roster_surname,
      r.school_raw AS roster_school
     FROM survey_responses s
     LEFT JOIN decisions d ON d.response_id = s.response_id AND d.undone_at IS NULL
     LEFT JOIN roster_children r ON r.roster_child_id = d.roster_child_id
     ORDER BY s.recorded_date_raw DESC, s.survey_row_index DESC, s.response_id`
  );
}

async function getSchoolSummaries() {
  return rows(
    getDb(),
    `SELECT school.school_raw,
      school.roster_count,
      school.matched_count,
      school.roster_count - school.matched_count AS available_count,
      COALESCE(response_counts.response_count, 0) AS response_count,
      COALESCE(response_counts.unresolved_response_count, 0) AS unresolved_response_count,
      COALESCE(no_candidates.no_candidate_count, 0) AS no_candidate_count,
      CASE WHEN school.roster_count = 0 THEN 0 ELSE ROUND((school.matched_count * 100.0) / school.roster_count, 1) END AS match_rate
     FROM (
       SELECT r.school_raw,
         COUNT(*) AS roster_count,
         SUM(CASE WHEN d.id IS NULL THEN 0 ELSE 1 END) AS matched_count
       FROM roster_children r
       LEFT JOIN decisions d
         ON d.roster_child_id = r.roster_child_id
         AND d.undone_at IS NULL
         AND d.action = 'matched'
       GROUP BY r.school_raw
     ) school
     LEFT JOIN (
       SELECT entered_school_raw AS school_raw,
         COUNT(*) AS response_count,
         SUM(CASE WHEN d.id IS NULL THEN 1 ELSE 0 END) AS unresolved_response_count
       FROM survey_responses s
       LEFT JOIN decisions d ON d.response_id = s.response_id AND d.undone_at IS NULL
       WHERE TRIM(COALESCE(entered_school_raw, '')) <> ''
       GROUP BY entered_school_raw
     ) response_counts ON response_counts.school_raw = school.school_raw
     LEFT JOIN (
       SELECT entered_school_raw AS school_raw, COUNT(*) AS no_candidate_count
       FROM survey_responses s
       WHERE ${reviewableWhere()}
         AND NOT EXISTS (SELECT 1 FROM candidates c WHERE c.response_id = s.response_id)
       GROUP BY entered_school_raw
     ) no_candidates ON no_candidates.school_raw = school.school_raw
     ORDER BY school.school_raw`
  );
}

async function getDataQualityIssues() {
  const database = getDb();
  const issues: Array<Record<string, unknown>> = [];
  issues.push(
    ...(await rows(database,
      `SELECT
        'response_no_candidates:' || s.response_id AS id,
        'Responses with no candidates' AS category,
        'warning' AS severity,
        COALESCE(NULLIF(s.entered_forename_raw, ''), s.response_id) AS subject,
        s.entered_school_raw AS school_raw,
        'Reviewable response has no generated roster candidates.' AS detail,
        s.response_id,
        NULL AS roster_child_id
       FROM survey_responses s
       WHERE ${reviewableWhere()}
         AND NOT EXISTS (SELECT 1 FROM candidates c WHERE c.response_id = s.response_id)`
    ))
  );
  issues.push(
    ...(await rows(database,
      `SELECT
        'multiple_high_candidates:' || s.response_id AS id,
        'Multiple high-confidence candidates' AS category,
        'review' AS severity,
        COALESCE(NULLIF(s.entered_forename_raw, ''), s.response_id) AS subject,
        s.entered_school_raw AS school_raw,
        COUNT(*) || ' high preselect candidates generated.' AS detail,
        s.response_id,
        NULL AS roster_child_id
       FROM survey_responses s
       JOIN candidates c ON c.response_id = s.response_id AND c.confidence = 'high_preselect'
       GROUP BY s.response_id
       HAVING COUNT(*) > 1`
    ))
  );
  issues.push(
    ...(await rows(database,
      `SELECT
        'roster_missing_dob:' || r.roster_child_id AS id,
        'Missing or invalid DOBs' AS category,
        'warning' AS severity,
        TRIM(r.forename_raw || ' ' || r.surname_raw) AS subject,
        r.school_raw,
        'Roster pupil is missing a full ISO date of birth.' AS detail,
        NULL AS response_id,
        r.roster_child_id
       FROM roster_children r
       WHERE TRIM(COALESCE(r.dob_iso, '')) = ''`
    ))
  );
  issues.push(
    ...(await rows(database,
      `SELECT
        'response_missing_birth:' || s.response_id AS id,
        'Missing or invalid DOBs' AS category,
        'review' AS severity,
        COALESCE(NULLIF(s.entered_forename_raw, ''), s.response_id) AS subject,
        s.entered_school_raw AS school_raw,
        'Survey response is missing birth month/year.' AS detail,
        s.response_id,
        NULL AS roster_child_id
       FROM survey_responses s
       WHERE ${reviewableWhere()}
         AND TRIM(COALESCE(s.birth_month_year, '')) = ''`
    ))
  );
  issues.push(
    ...(await rows(database,
      `SELECT
        'matched_later_duplicate:' || d.response_id AS id,
        'Matched pupils with later duplicate responses' AS category,
        'review' AS severity,
        TRIM(r.forename_raw || ' ' || r.surname_raw) AS subject,
        r.school_raw,
        'Matched pupil also has responses currently marked duplicate.' AS detail,
        d.response_id,
        d.roster_child_id
       FROM decisions d
       JOIN roster_children r ON r.roster_child_id = d.roster_child_id
       WHERE d.undone_at IS NULL
         AND d.action = 'matched'
         AND EXISTS (
           SELECT 1
           FROM decisions duplicate_decision
           WHERE duplicate_decision.roster_child_id = d.roster_child_id
             AND duplicate_decision.undone_at IS NULL
             AND duplicate_decision.action = 'duplicate'
         )`
    ))
  );
  issues.push(
    ...(await getSchoolSummaries())
      .filter((school) => Number((school as Record<string, unknown>).match_rate ?? 0) < 50)
      .map((school) => ({
        id: `low_school_coverage:${school.school_raw}`,
        category: "Schools with low match coverage",
        severity: "review",
        subject: school.school_raw,
        school_raw: school.school_raw,
        detail: `${school.match_rate}% of roster pupils are matched.`,
        response_id: null,
        roster_child_id: null
      }))
  );
  return issues;
}

async function getAuditEvents() {
  const decisionEvents = await rows(
    getDb(),
    `SELECT
      'decision:' || d.id AS id,
      CASE WHEN d.undone_at IS NULL THEN 'decision_active' ELSE 'decision_reopened' END AS event_type,
      COALESCE(d.undone_at, d.created_at) AS occurred_at,
      COALESCE(CASE WHEN d.undone_at IS NULL THEN d.created_by ELSE d.undone_by END, d.created_by, 'local user') AS actor,
      d.action AS subject,
      CASE
        WHEN d.undone_at IS NULL THEN 'Decision recorded for response ' || d.response_id
        ELSE 'Decision reopened for response ' || d.response_id
      END AS detail,
      d.response_id,
      d.roster_child_id
     FROM decisions d`
  );
  const rosterEvents = await rows(
    getDb(),
    `SELECT
      'roster_addition:' || roster_child_id AS id,
      'roster_addition' AS event_type,
      created_at AS occurred_at,
      COALESCE(created_by, 'local user') AS actor,
      TRIM(forename_raw || ' ' || surname_raw) AS subject,
      'Roster pupil added to ' || school_raw AS detail,
      NULL AS response_id,
      roster_child_id
     FROM roster_additions`
  );
  const explicitEvents = await rows(
    getDb(),
    `SELECT
      'audit:' || id AS id,
      event_type,
      occurred_at,
      actor,
      subject,
      detail,
      response_id,
      roster_child_id
     FROM audit_events`
  );
  return [...decisionEvents, ...rosterEvents, ...explicitEvents].sort((left, right) =>
    String((right as Record<string, unknown>).occurred_at ?? "").localeCompare(String((left as Record<string, unknown>).occurred_at ?? ""))
  );
}

async function getImportHistory() {
  return rows(
    getDb(),
    `SELECT
       CAST(id AS TEXT) AS id,
       imported_at,
       raw_upload_path AS source,
       backup_path AS backup_dir,
       raw_upload_name AS raw_upload,
       new_response_rows AS survey_rows,
       candidate_rows
     FROM import_runs
     ORDER BY imported_at DESC, id DESC`
  );
}

async function getSchools() {
  return rows(
    getDb(),
    `SELECT school_raw, COUNT(*) AS roster_count
     FROM roster_children
     WHERE TRIM(COALESCE(school_raw, '')) <> ''
     GROUP BY school_raw
     ORDER BY school_raw`
  );
}

function manualChildId(...parts: string[]) {
  const seed = `${parts.join("|")}|${crypto.randomUUID()}`;
  const digest = crypto.createHash("sha1").update(seed).digest("hex").slice(0, 12);
  return `manual_${digest}`;
}

function validateDobIso(value: string) {
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error("DOB must be entered as YYYY-MM-DD.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isValid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!isValid) throw new Error("DOB is not a valid calendar date.");
  if (year < 2008 || year > 2016) throw new Error("DOB year is outside the expected pupil range.");
  return {
    dobIso: text,
    birthMonth: String(month).padStart(2, "0"),
    birthYear: String(year)
  };
}

async function insertRosterChild(
  database: PgDatabase,
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
  await run(
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

function collectFieldnames(rowsToWrite: CsvRow[], preferred: string[] = []) {
  const seen = new Set<string>();
  const fieldnames: string[] = [];
  for (const field of preferred) {
    if (!field || seen.has(field)) continue;
    seen.add(field);
    fieldnames.push(field);
  }
  for (const row of rowsToWrite) {
    for (const field of Object.keys(row)) {
      if (!field || seen.has(field)) continue;
      seen.add(field);
      fieldnames.push(field);
    }
  }
  return fieldnames;
}

function writeCsvRows(filePath: string, rowsToWrite: CsvRow[], preferredFieldnames: string[] = []) {
  const fieldnames = collectFieldnames(rowsToWrite, preferredFieldnames);
  const lines = [
    fieldnames.map(csvEscape).join(","),
    ...rowsToWrite.map((row) => fieldnames.map((field) => csvEscape(row[field] ?? "")).join(","))
  ];
  fs.writeFileSync(filePath, `\ufeff${lines.join("\r\n")}\r\n`, "utf8");
}

async function writeCurrentRosterCsv(database: PgDatabase, filePath: string) {
  const rosterRows = await rows<CsvRow>(
    database,
    `SELECT
       roster_child_id,
       roster_file,
       school_raw,
       source_row,
       forename_raw,
       surname_raw,
       dob_iso,
       birth_month,
       birth_year
     FROM roster_children
     WHERE withdrawn_at IS NULL
     ORDER BY school_raw, surname_raw, forename_raw, dob_iso, roster_child_id`
  );
  writeCsvRows(filePath, rosterRows, [
    "roster_child_id",
    "roster_file",
    "school_raw",
    "source_row",
    "forename_raw",
    "surname_raw",
    "dob_iso",
    "birth_month",
    "birth_year"
  ]);
}

async function insertSurveyResponse(database: PgDatabase, row: CsvRow) {
  await run(
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
  await run(database, "INSERT INTO survey_response_full_rows (response_id, raw_json) VALUES (?, ?)", [
    row.response_id,
    JSON.stringify(row)
  ]);
}

async function insertCandidate(database: PgDatabase, row: CsvRow) {
  await run(
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

async function addRosterStudent(payload: AddRosterStudentPayload, context: RequestContext) {
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

  const duplicate = await one<{ roster_child_id: string }>(
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
  if (duplicate) throw new Error("A roster pupil with those exact details already exists.");

  const rosterChildId = manualChildId(schoolRaw, forenameRaw, surnameRaw, dob.dobIso);
  const now = new Date().toISOString();
  try {
    await transaction(async (client) => {
    await run(
      client,
      `INSERT INTO roster_additions (
        roster_child_id, school_raw, forename_raw, surname_raw, dob_iso,
        birth_month, birth_year, sex, upn, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [rosterChildId, schoolRaw, forenameRaw, surnameRaw, dob.dobIso, dob.birthMonth, dob.birthYear, sex, upn, now, currentUserLabel(context.user)]
    );
    await insertRosterChild(client, {
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
    await recordAuditEvent(client, {
      eventType: "roster_addition",
      actor: currentUserLabel(context.user),
      subject: `${forenameRaw} ${surnameRaw}`,
      detail: `Roster pupil added to ${schoolRaw}`,
      rosterChildId,
      occurredAt: now
    });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError(409, "A roster pupil with those details already exists.");
    }
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

async function searchRoster(query: string) {
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

async function getRosterCoverage() {
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

function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvContent(exportRows: ExportRow[], fieldnames: string[]) {
  const lines = [
    fieldnames.map(csvEscape).join(","),
    ...exportRows.map((row) => fieldnames.map((field) => csvEscape(row[field])).join(","))
  ];
  return `\ufeff${lines.join("\r\n")}\r\n`;
}

function parseFullSurveyRow(rawJson: string | Record<string, string> | null | undefined): CsvRow {
  if (!rawJson) return {};
  if (typeof rawJson === "object") return rawJson;
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
      if (!field || processedSurveyColumns.has(field) || seen.has(field)) continue;
      seen.add(field);
      fieldnames.push(field);
    }
  }
  return fieldnames;
}

function qualtricsExportColumn(field: string) {
  return `qualtrics__${field}`;
}

async function buildMatchedSurveyResponseExport() {
  const matchedRows = await rows<Record<string, unknown>>(
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

  const fullRows = matchedRows.map((row) => parseFullSurveyRow(row.raw_json as string | null));
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
    for (const field of baseFieldnames) exportRow[field] = row[field];
    const fullRow = fullRows[index];
    for (const field of qualtricsFields) exportRow[qualtricsExportColumn(field)] = fullRow[field] ?? "";
    return exportRow;
  });

  return {
    fieldnames: [...baseFieldnames, ...qualtricsFields.map(qualtricsExportColumn)],
    exportRows
  };
}

async function buildRosterCoverageExport() {
  const coverageRows = await rows<Record<string, unknown>>(
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

async function buildUnmatchedRosterPupilsExport() {
  const exportRows = (await getPupils()).filter((row) => row.status !== "matched") as ExportRow[];
  return {
    fieldnames: [
      "roster_child_id",
      "roster_file",
      "school_raw",
      "source_row",
      "forename_raw",
      "surname_raw",
      "dob_iso",
      "birth_month",
      "birth_year",
      "status",
      "candidate_count"
    ],
    exportRows
  };
}

async function buildUnresolvedResponsesExport() {
  const exportRows = ((await getResponses()) as ExportRow[]).filter((row) =>
    ["unreviewed", "deferred", "ambiguous", "duplicate", "no_match"].includes(String(row.status))
  );
  return {
    fieldnames: [
      "response_id",
      "survey_row_index",
      "status",
      "entered_forename_raw",
      "entered_school_raw",
      "birth_month_year",
      "progress",
      "finished",
      "response_class",
      "recorded_date_raw",
      "candidate_count",
      "top_confidence",
      "decision_id",
      "decided_at"
    ],
    exportRows
  };
}

async function buildDecisionActionExport(action: string) {
  const exportRows = ((await getReviewedRecords()) as ExportRow[]).filter((row) => row.action === action);
  return {
    fieldnames: [
      "decision_id",
      "response_id",
      "roster_child_id",
      "action",
      "note",
      "decided_at",
      "entered_forename_raw",
      "entered_school_raw",
      "birth_month_year",
      "progress",
      "recorded_date_raw",
      "roster_forename",
      "roster_surname",
      "roster_school",
      "roster_dob_iso",
      "candidate_count",
      "top_confidence",
      "accepted_score",
      "accepted_reason_codes"
    ],
    exportRows
  };
}

async function buildAuditExport() {
  return {
    fieldnames: ["id", "event_type", "occurred_at", "actor", "subject", "detail", "response_id", "roster_child_id"],
    exportRows: (await getAuditEvents()) as ExportRow[]
  };
}

async function buildSchoolProgressExport() {
  return {
    fieldnames: [
      "school_raw",
      "roster_count",
      "matched_count",
      "available_count",
      "response_count",
      "unresolved_response_count",
      "no_candidate_count",
      "match_rate"
    ],
    exportRows: (await getSchoolSummaries()) as ExportRow[]
  };
}

async function parseBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function readRequestBuffer(request: http.IncomingMessage, maxBytes = 150 * 1024 * 1024) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("Uploaded file is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function safeImportFilename(value: string | undefined) {
  const decoded = value ? decodeURIComponent(value) : "qualtrics-upload.csv";
  const basename = path.basename(decoded).replace(/[^a-zA-Z0-9._ -]+/g, "_").trim();
  return basename || "qualtrics-upload.csv";
}

function timestampForImport() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function runPythonScript(scriptName: string, args: string[]) {
  const pythonCandidates = [
    process.env.PYTHON,
    path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe"),
    "python"
  ].filter(Boolean) as string[];
  const python = pythonCandidates.find((candidate) => candidate === "python" || fs.existsSync(candidate)) ?? "python";
  const scriptPath = path.join(scriptsDir, scriptName);
  const { stdout, stderr } = await execFileAsync(python, [scriptPath, ...args], {
    cwd: workspaceRoot,
    maxBuffer: 20 * 1024 * 1024
  });
  return { stdout, stderr };
}

function appendRowsToCsv(filePath: string, newRows: CsvRow[]) {
  if (!newRows.length) return;
  const existingRows = fs.existsSync(filePath) ? readCsv(filePath) : [];
  const preferredFieldnames = existingRows.length ? Object.keys(existingRows[0]) : Object.keys(newRows[0]);
  writeCsvRows(filePath, [...existingRows, ...newRows], preferredFieldnames);
}

async function importRawQualtricsUpload(buffer: Buffer, filenameHeader: string | undefined, context: RequestContext) {
  const filename = safeImportFilename(filenameHeader);
  const lowerName = filename.toLowerCase();
  if (!lowerName.endsWith(".csv") && !lowerName.endsWith(".zip")) {
    throw new Error("Upload a raw Qualtrics CSV or a zip containing one Qualtrics CSV.");
  }

  const stamp = timestampForImport();
  const importRoot = path.join(outputsDir, "raw_imports", stamp);
  const stagingDir = path.join(importRoot, "staging");
  fs.mkdirSync(stagingDir, { recursive: true });
  const uploadedPath = path.join(importRoot, filename);
  fs.writeFileSync(uploadedPath, buffer);

  const database = getDb();
  await writeCurrentRosterCsv(database, path.join(stagingDir, "normalized_roster.csv"));
  await runPythonScript("build_survey.py", ["--zip", uploadedPath, "--out", stagingDir]);
  await runPythonScript("generate_match_candidates.py", ["--out", stagingDir]);

  const stagedSurveyPath = path.join(stagingDir, "deduped_survey_full_responses.csv");
  const stagedCandidatePath = path.join(stagingDir, "match_candidates.csv");
  const stagedSurveyRows = readCsv(stagedSurveyPath);
  const stagedCandidateRows = readCsv(stagedCandidatePath);

  const existingIds = new Set((await rows<{ response_id: string }>(database, "SELECT response_id FROM survey_responses")).map((row) => row.response_id));
  const newSurveyRows = stagedSurveyRows.filter(
    (row) => row.response_id && !existingIds.has(row.response_id) && (!row.is_canonical_response || row.is_canonical_response === "true")
  );
  const newIds = new Set(newSurveyRows.map((row) => row.response_id));
  const newCandidateRows = stagedCandidateRows.filter((row) => newIds.has(row.response_id));

  const backupDir = path.join(outputsDir, "import_backups", stamp);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const filenameToBackup of ["deduped_survey_full_responses.csv", "match_candidates.csv", "matcher_review.sqlite"]) {
    const sourcePath = path.join(outputsDir, filenameToBackup);
    if (fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, path.join(backupDir, filenameToBackup));
  }

  try {
    await transaction(async (client) => {
    for (const row of newSurveyRows) await insertSurveyResponse(client, row);
    for (const row of newCandidateRows) await insertCandidate(client, row);
    await run(
      client,
      `INSERT INTO import_runs (
        imported_at, imported_by, raw_upload_name, raw_upload_path, backup_path,
        raw_rows, new_response_rows, skipped_existing_responses, candidate_rows,
        status, warnings_json, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        new Date().toISOString(),
        currentUserLabel(context.user),
        filename,
        uploadedPath,
        backupDir,
        stagedSurveyRows.length,
        newSurveyRows.length,
        stagedSurveyRows.length - newSurveyRows.length,
        newCandidateRows.length,
        "completed",
        JSON.stringify([]),
        null
      ]
    );
    await recordAuditEvent(client, {
      eventType: "import_completed",
      actor: currentUserLabel(context.user),
      subject: filename,
      detail: `Imported ${newSurveyRows.length} new responses and ${newCandidateRows.length} candidate rows.`,
      occurredAt: new Date().toISOString()
    });
    });
  } catch (error) {
    try {
      await run(
        database,
        `INSERT INTO import_runs (
          imported_at, imported_by, raw_upload_name, raw_upload_path, backup_path,
          raw_rows, new_response_rows, skipped_existing_responses, candidate_rows,
          status, warnings_json, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          new Date().toISOString(),
          currentUserLabel(context.user),
          filename,
          uploadedPath,
          backupDir,
          stagedSurveyRows.length,
          0,
          0,
          0,
          "failed",
          JSON.stringify([]),
          error instanceof Error ? error.message : String(error)
        ]
      );
    } catch {
      // Preserve the original import failure.
    }
    throw error;
  }

  appendRowsToCsv(path.join(outputsDir, "deduped_survey_full_responses.csv"), newSurveyRows);
  appendRowsToCsv(path.join(outputsDir, "match_candidates.csv"), newCandidateRows);

  const alreadyMatchedTopCandidates = (await rows<{ count: number }>(
    database,
    `SELECT COUNT(*) AS count
     FROM candidates c
     JOIN decisions d
       ON d.roster_child_id = c.roster_child_id
       AND d.undone_at IS NULL
       AND d.action = 'matched'
     WHERE c.response_id IN (${newSurveyRows.map(() => "?").join(",") || "NULL"})
       AND c.candidate_rank = 1`,
    [...newIds]
  ))[0]?.count ?? 0;

  return {
    ok: true,
    cancelled: false,
    sourceFolder: importRoot,
    backupDir,
    surveyRows: newSurveyRows.length,
    candidateRows: newCandidateRows.length,
    stats: await getStats(),
    rawRows: stagedSurveyRows.length,
    skippedExistingResponses: stagedSurveyRows.length - newSurveyRows.length,
    alreadyMatchedTopCandidates
  };
}

function sendJson(response: http.ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendCsv(response: http.ServerResponse, filename: string, exportData: { fieldnames: string[]; exportRows: ExportRow[] }) {
  response.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "X-Export-Rows": String(exportData.exportRows.length),
    "Cache-Control": "no-store"
  });
  response.end(csvContent(exportData.exportRows, exportData.fieldnames), "utf8");
}

async function sendAuditedCsv(
  response: http.ServerResponse,
  context: RequestContext,
  exportKey: string,
  filename: string,
  exportData: { fieldnames: string[]; exportRows: ExportRow[] }
) {
  await recordAuditEvent(getDb(), {
    eventType: "export_created",
    actor: currentUserLabel(context.user),
    subject: exportKey,
    detail: `Exported ${exportData.exportRows.length} rows to ${filename}.`
  });
  return sendCsv(response, filename, exportData);
}

function contentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

function serveStatic(requestUrl: URL, response: http.ServerResponse) {
  const rawPath = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
  const requestedPath = path.normalize(rawPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(distDir, requestedPath);
  if (!filePath.startsWith(distDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, "index.html");
  }
  response.writeHead(200, { "Content-Type": contentType(filePath) });
  fs.createReadStream(filePath).pipe(response);
}

async function handleApi(request: http.IncomingMessage, response: http.ServerResponse, requestUrl: URL) {
  const route = requestUrl.pathname.replace(/^\/api\/?/, "");
  if (request.method === "GET" && route === "health") {
    return sendJson(response, 200, { ok: true });
  }
  if (request.method === "POST" && route === "auth/login") {
    const body = await parseBody(request);
    return sendJson(response, 200, await loginUser(String(body.username ?? ""), String(body.password ?? ""), response));
  }
  if (request.method === "POST" && route === "auth/logout") {
    return sendJson(response, 200, await logoutUser(request, response));
  }
  if (request.method === "GET" && route === "auth/me") {
    return sendJson(response, 200, { user: publicUser(await getRequestUser(request)) });
  }

  const context = await requireUser(request);
  if (request.method === "GET" && route === "init") return sendJson(response, 200, { dataRoot, dbPath });
  if (request.method === "GET" && route === "stats") return sendJson(response, 200, await getStats());
  if (request.method === "GET" && route === "next-response") return sendJson(response, 200, await getNextResponse(requestUrl.searchParams.get("queue") ?? "unreviewed"));
  if (request.method === "GET" && route === "candidates") return sendJson(response, 200, await getCandidates(requestUrl.searchParams.get("responseId") ?? ""));
  if (request.method === "POST" && route === "record-decision") return sendJson(response, 200, await recordDecision(await parseBody(request), context));
  if (request.method === "POST" && route === "undo-last") return sendJson(response, 200, await undoLast(context));
  if (request.method === "POST" && route === "undo-decision") {
    const body = await parseBody(request);
    return sendJson(response, 200, await undoDecision(Number(body.decisionId), context));
  }
  if (request.method === "GET" && route === "search-roster") return sendJson(response, 200, await searchRoster(requestUrl.searchParams.get("query") ?? ""));
  if (request.method === "GET" && route === "roster-coverage") return sendJson(response, 200, await getRosterCoverage());
  if (request.method === "GET" && route === "reviewed-records") return sendJson(response, 200, await getReviewedRecords());
  if (request.method === "GET" && route === "pupils") return sendJson(response, 200, await getPupils());
  if (request.method === "GET" && route === "responses") return sendJson(response, 200, await getResponses());
  if (request.method === "GET" && route === "school-summaries") return sendJson(response, 200, await getSchoolSummaries());
  if (request.method === "GET" && route === "data-quality") return sendJson(response, 200, await getDataQualityIssues());
  if (request.method === "GET" && route === "audit-events") return sendJson(response, 200, await getAuditEvents());
  if (request.method === "GET" && route === "import-history") return sendJson(response, 200, await getImportHistory());
  if (request.method === "GET" && route === "schools") return sendJson(response, 200, await getSchools());
  if (request.method === "POST" && route === "add-roster-student") return sendJson(response, 200, await addRosterStudent(await parseBody(request), context));
  if (request.method === "POST" && route === "import-processed-source-folder") return sendJson(response, 200, { ok: false, cancelled: true });
  if (request.method === "POST" && route === "import/raw-qualtrics") {
    return sendJson(response, 200, await importRawQualtricsUpload(await readRequestBuffer(request), request.headers["x-filename"] as string | undefined, context));
  }
  if (request.method === "GET" && route === "export/matched") return sendAuditedCsv(response, context, "matched pupil-response export", "matched_pupil_survey_export.csv", await buildMatchedSurveyResponseExport());
  if (request.method === "GET" && route === "export/coverage") return sendAuditedCsv(response, context, "roster coverage export", "roster_coverage_export.csv", await buildRosterCoverageExport());
  if (request.method === "GET" && route === "export/unmatched-pupils") return sendAuditedCsv(response, context, "unmatched roster pupils", "unmatched_roster_pupils.csv", await buildUnmatchedRosterPupilsExport());
  if (request.method === "GET" && route === "export/unresolved-responses") return sendAuditedCsv(response, context, "unresolved responses", "unresolved_responses.csv", await buildUnresolvedResponsesExport());
  if (request.method === "GET" && route === "export/ambiguous-decisions") return sendAuditedCsv(response, context, "ambiguous decisions", "ambiguous_decisions.csv", await buildDecisionActionExport("ambiguous"));
  if (request.method === "GET" && route === "export/deferred-decisions") return sendAuditedCsv(response, context, "deferred decisions", "deferred_decisions.csv", await buildDecisionActionExport("deferred"));
  if (request.method === "GET" && route === "export/duplicate-decisions") return sendAuditedCsv(response, context, "duplicate response decisions", "duplicate_response_decisions.csv", await buildDecisionActionExport("duplicate"));
  if (request.method === "GET" && route === "export/no-match-decisions") return sendAuditedCsv(response, context, "no-match decisions", "no_match_decisions.csv", await buildDecisionActionExport("no_match"));
  if (request.method === "GET" && route === "export/audit-log") return sendAuditedCsv(response, context, "audit log", "audit_log.csv", await buildAuditExport());
  if (request.method === "GET" && route === "export/school-progress") return sendAuditedCsv(response, context, "school progress summary", "school_progress_summary.csv", await buildSchoolProgressExport());
  return sendJson(response, 404, { message: "Unknown API route." });
}

function lanUrls() {
  const addresses: string[] = [];
  for (const network of Object.values(os.networkInterfaces())) {
    for (const address of network ?? []) {
      if (address.family === "IPv4" && !address.internal) addresses.push(`http://${address.address}:${port}`);
    }
  }
  return addresses;
}

async function main() {
  await initDatabase();

  const server = http.createServer((request, response) => {
    void (async () => {
      try {
        const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
        if (requestUrl.pathname.startsWith("/api/")) {
          await handleApi(request, response, requestUrl);
        } else {
          serveStatic(requestUrl, response);
        }
      } catch (error) {
        if (error instanceof ApiError) {
          sendJson(response, error.status, { message: error.message });
          return;
        }
        sendJson(response, 500, { message: error instanceof Error ? error.message : "Unexpected server error." });
      }
    })();
  });

  server.listen(port, host, () => {
    console.log(`Survey Roster Matcher web app`);
    console.log(`Local: http://127.0.0.1:${port}`);
    for (const url of lanUrls()) console.log(`LAN:   ${url}`);
    console.log(`Data:  ${dataRoot}`);
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
