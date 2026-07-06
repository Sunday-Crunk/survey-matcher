export type QueueName = "unreviewed" | "deferred" | "ambiguous" | "duplicate";
export type DecisionAction = "matched" | "deferred" | "no_match" | "ambiguous" | "duplicate";

export type Stats = {
  responseCount: number;
  reviewable: number;
  unreviewed: number;
  matched: number;
  deferred: number;
  noMatch: number;
  ambiguous: number;
  duplicate: number;
  preselected: number;
  noCandidate: number;
  rosterChildren: number;
};

export type SurveyResponse = {
  response_id: string;
  survey_row_index: number;
  entered_forename_raw: string;
  entered_school_raw: string;
  birth_month_year: string;
  progress: number;
  finished: string;
  response_class: string;
  recorded_date_raw: string;
  dedupe_group_key: string;
  dedupe_decision: string;
  duplicate_response_classification: string;
  manual_identifier_decision: string;
  candidate_count: number;
  top_confidence: string;
  active_decision_id?: number | null;
  active_decision_action?: DecisionAction | null;
};

export type Candidate = {
  response_id: string;
  candidate_rank: number;
  confidence: string;
  preselected: string;
  score: number;
  top_gap: number;
  school_score: number;
  name_score: number;
  dob_status: string;
  reason_codes: string;
  roster_child_id: string;
  roster_forename: string;
  roster_surname: string;
  roster_school: string;
  roster_birth_month_year: string;
  roster_dob_iso: string;
  matched_response_id?: string;
  matched_decision_id?: number;
};

export type RosterSearchResult = {
  roster_child_id: string;
  roster_file?: string;
  school_raw: string;
  source_row: number;
  forename_raw: string;
  surname_raw: string;
  dob_iso: string;
  birth_month: string;
  birth_year: string;
  matched_response_id?: string;
};

export type RosterSchool = {
  school_raw: string;
  roster_count: number;
};

export type PupilRecord = {
  roster_child_id: string;
  roster_file: string;
  school_raw: string;
  source_row: number;
  forename_raw: string;
  surname_raw: string;
  dob_iso: string;
  birth_month: string;
  birth_year: string;
  status: "available" | "matched";
  matched_response_id: string | null;
  matched_decision_id: number | null;
  matched_at: string | null;
  candidate_count: number;
};

export type ResponseStatus = "unreviewed" | DecisionAction;

export type ResponseRecord = SurveyResponse & {
  status: ResponseStatus;
  decision_id: number | null;
  decided_at: string | null;
  roster_child_id: string | null;
  roster_forename: string | null;
  roster_surname: string | null;
  roster_school: string | null;
};

export type SchoolSummary = {
  school_raw: string;
  roster_count: number;
  matched_count: number;
  available_count: number;
  response_count: number;
  unresolved_response_count: number;
  no_candidate_count: number;
  match_rate: number;
};

export type DataQualityIssue = {
  id: string;
  category: string;
  severity: "review" | "warning";
  subject: string;
  school_raw: string;
  detail: string;
  response_id: string | null;
  roster_child_id: string | null;
};

export type AuditEvent = {
  id: string;
  event_type: string;
  occurred_at: string;
  actor: string;
  subject: string;
  detail: string;
  response_id: string | null;
  roster_child_id: string | null;
};

export type ImportHistoryRecord = {
  id: string;
  imported_at: string;
  source: string;
  backup_dir: string;
  raw_upload: string;
  survey_rows: number | null;
  candidate_rows: number | null;
};

export type RecordDecisionPayload = {
  responseId: string;
  rosterChildId?: string;
  action: DecisionAction;
  note?: string;
  revisesDecisionId?: number;
};

export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
};

export type LoginPayload = {
  username: string;
  password: string;
};

export type AddRosterStudentPayload = {
  schoolRaw: string;
  forenameRaw: string;
  surnameRaw: string;
  dobIso: string;
  sex?: string;
  upn?: string;
};

export type ReviewedRecord = {
  decision_id: number;
  response_id: string;
  roster_child_id: string | null;
  action: DecisionAction;
  note: string;
  decided_at: string;
  survey_row_index: number;
  entered_forename_raw: string;
  entered_school_raw: string;
  birth_month_year: string;
  progress: number;
  finished: string;
  response_class: string;
  recorded_date_raw: string;
  dedupe_group_key: string;
  roster_forename: string | null;
  roster_surname: string | null;
  roster_school: string | null;
  roster_dob_iso: string | null;
  roster_birth_month: string | null;
  roster_birth_year: string | null;
  accepted_candidate_rank: number | null;
  accepted_confidence: string | null;
  accepted_score: number | null;
  accepted_school_score: number | null;
  accepted_name_score: number | null;
  accepted_reason_codes: string | null;
  candidate_count: number;
  top_confidence: string;
};

export type ImportProcessedSourceResult =
  | {
      ok: true;
      cancelled: false;
      sourceFolder: string;
      backupDir: string;
      surveyRows: number;
      candidateRows: number;
      stats: Stats;
      rawRows?: number;
      skippedExistingResponses?: number;
      alreadyMatchedTopCandidates?: number;
    }
  | {
      ok: false;
      cancelled: true;
    };

export type ExportCsvResult =
  | {
      ok: true;
      cancelled: false;
      filePath: string;
      rows: number;
    }
  | {
      ok: false;
      cancelled: true;
    };

export type MatcherApi = {
  init: () => Promise<{ dataRoot: string; dbPath: string }>;
  login: (payload: LoginPayload) => Promise<{ ok: true; user: AuthUser }>;
  logout: () => Promise<{ ok: true }>;
  getCurrentUser: () => Promise<{ user: AuthUser | null }>;
  getStats: () => Promise<Stats>;
  getNextResponse: (queue: QueueName) => Promise<SurveyResponse | null>;
  getCandidates: (responseId: string) => Promise<Candidate[]>;
  recordDecision: (payload: RecordDecisionPayload) => Promise<{ ok: true }>;
  undoLast: () => Promise<{ ok: boolean; message?: string; undone?: unknown }>;
  undoDecision: (decisionId: number) => Promise<{ ok: boolean; message?: string; undone?: unknown }>;
  searchRoster: (query: string) => Promise<RosterSearchResult[]>;
  getRosterCoverage: () => Promise<Array<{ school_raw: string; roster_count: number; matched_count: number }>>;
  getReviewedRecords: () => Promise<ReviewedRecord[]>;
  getPupils: () => Promise<PupilRecord[]>;
  getResponses: () => Promise<ResponseRecord[]>;
  getSchoolSummaries: () => Promise<SchoolSummary[]>;
  getDataQualityIssues: () => Promise<DataQualityIssue[]>;
  getAuditEvents: () => Promise<AuditEvent[]>;
  getImportHistory: () => Promise<ImportHistoryRecord[]>;
  getSchools: () => Promise<RosterSchool[]>;
  addRosterStudent: (payload: AddRosterStudentPayload) => Promise<RosterSearchResult>;
  importProcessedSourceFolder: () => Promise<ImportProcessedSourceResult>;
  importRawQualtricsFile: (file: File) => Promise<ImportProcessedSourceResult>;
  exportMatchedSurveyResponses: () => Promise<ExportCsvResult>;
  exportRosterCoverage: () => Promise<ExportCsvResult>;
};
