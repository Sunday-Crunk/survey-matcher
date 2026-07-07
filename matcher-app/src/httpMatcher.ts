import type { ExportCsvResult, LoginPayload, MatcherApi, QueueName, RecordDecisionPayload } from "./types";

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message ?? `Request failed: ${response.status}`);
  }
  return data as T;
}

async function downloadCsv(path: string, filename: string): Promise<ExportCsvResult> {
  const response = await fetch(`/api/${path}`, { credentials: "same-origin" });
  if (!response.ok) {
    const text = await response.text();
    let message = `Export failed: ${response.status}`;
    try {
      message = JSON.parse(text).message ?? message;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);

  return {
    ok: true,
    cancelled: false,
    filePath: filename,
    rows: Number(response.headers.get("X-Export-Rows") ?? 0)
  };
}

export function createMatcherApi(): MatcherApi {
  if (window.matcher) return window.matcher;

  return {
    init: () => requestJson("init"),
    login: (payload: LoginPayload) =>
      requestJson("auth/login", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    logout: () => requestJson("auth/logout", { method: "POST" }),
    getCurrentUser: () => requestJson("auth/me"),
    getStats: () => requestJson("stats"),
    getNextResponse: (queue: QueueName) => requestJson(`next-response?queue=${encodeURIComponent(queue)}`),
    getCandidates: (responseId: string) => requestJson(`candidates?responseId=${encodeURIComponent(responseId)}`),
    recordDecision: (payload: RecordDecisionPayload) =>
      requestJson("record-decision", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    undoLast: () => requestJson("undo-last", { method: "POST" }),
    undoDecision: (decisionId: number) =>
      requestJson("undo-decision", {
        method: "POST",
        body: JSON.stringify({ decisionId })
      }),
    searchRoster: (query: string) => requestJson(`search-roster?query=${encodeURIComponent(query)}`),
    getRosterCoverage: () => requestJson("roster-coverage"),
    getReviewedRecords: () => requestJson("reviewed-records"),
    getPupils: () => requestJson("pupils"),
    getResponses: () => requestJson("responses"),
    getResponseDetail: (responseId: string) => requestJson(`response-detail?responseId=${encodeURIComponent(responseId)}`),
    getSchoolSummaries: () => requestJson("school-summaries"),
    getDataQualityIssues: () => requestJson("data-quality"),
    getAuditEvents: () => requestJson("audit-events"),
    getImportHistory: () => requestJson("import-history"),
    getSchools: () => requestJson("schools"),
    addRosterStudent: (payload) =>
      requestJson("add-roster-student", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    importProcessedSourceFolder: () =>
      requestJson("import-processed-source-folder", {
        method: "POST"
      }),
    importRawQualtricsFile: async (file: File) => {
      const response = await fetch("/api/import/raw-qualtrics", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Filename": encodeURIComponent(file.name)
        },
        body: await file.arrayBuffer()
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (!response.ok) throw new Error(data?.message ?? `Import failed: ${response.status}`);
      return data;
    },
    exportMatchedSurveyResponses: () => downloadCsv("export/matched", "matched_pupil_survey_export.csv"),
    exportRosterCoverage: () => downloadCsv("export/coverage", "roster_coverage_export.csv")
  };
}
