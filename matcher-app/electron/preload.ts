import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("matcher", {
  init: () => ipcRenderer.invoke("matcher:init"),
  getStats: () => ipcRenderer.invoke("matcher:getStats"),
  getNextResponse: (queue: string) => ipcRenderer.invoke("matcher:getNextResponse", queue),
  getCandidates: (responseId: string) => ipcRenderer.invoke("matcher:getCandidates", responseId),
  recordDecision: (payload: RecordDecisionPayload) => ipcRenderer.invoke("matcher:recordDecision", payload),
  undoLast: () => ipcRenderer.invoke("matcher:undoLast"),
  undoDecision: (decisionId: number) => ipcRenderer.invoke("matcher:undoDecision", decisionId),
  searchRoster: (query: string) => ipcRenderer.invoke("matcher:searchRoster", query),
  getRosterCoverage: () => ipcRenderer.invoke("matcher:getRosterCoverage"),
  getReviewedRecords: () => ipcRenderer.invoke("matcher:getReviewedRecords"),
  getSchools: () => ipcRenderer.invoke("matcher:getSchools"),
  addRosterStudent: (payload: AddRosterStudentPayload) => ipcRenderer.invoke("matcher:addRosterStudent", payload),
  importProcessedSourceFolder: () => ipcRenderer.invoke("matcher:importProcessedSourceFolder"),
  importRawQualtricsFile: () => Promise.resolve({ ok: false, cancelled: true }),
  exportMatchedSurveyResponses: () => ipcRenderer.invoke("matcher:exportMatchedSurveyResponses"),
  exportRosterCoverage: () => ipcRenderer.invoke("matcher:exportRosterCoverage")
});

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
