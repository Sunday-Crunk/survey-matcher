import type { AddRosterStudentPayload, DecisionAction } from "@/types";

export type ViewName =
  | "dashboard"
  | "review"
  | "pupils"
  | "responses"
  | "matches"
  | "schools"
  | "quality"
  | "export"
  | "import"
  | "audit"
  | "help";

export type MatchStatusFilter = "all" | DecisionAction;
export type MatchSortKey = "decided_at" | "status" | "pupil" | "school" | "entered" | "birth" | "progress" | "score";
export type SortDirection = "asc" | "desc";
export type AddPupilFormState = AddRosterStudentPayload;
