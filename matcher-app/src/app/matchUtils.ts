import type { DecisionAction, QueueName, ReviewedRecord } from "@/types";
import type { MatchSortKey } from "./types";

export function cls(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function prettyConfidence(value: string) {
  if (value === "high_preselect") return "High";
  if (value === "medium_review") return "Medium";
  if (value === "low_review") return "Low";
  return value.replaceAll("_", " ");
}

export function actionLabel(value: DecisionAction) {
  if (value === "no_match") return "No match";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function reviewedPupilName(record: ReviewedRecord) {
  const name = `${record.roster_forename ?? ""} ${record.roster_surname ?? ""}`.trim();
  return name || "No roster child";
}

export function reviewedSortValue(record: ReviewedRecord, sortKey: MatchSortKey) {
  if (sortKey === "decided_at") return record.decided_at;
  if (sortKey === "status") return actionLabel(record.action);
  if (sortKey === "pupil") return reviewedPupilName(record);
  if (sortKey === "school") return record.roster_school ?? "";
  if (sortKey === "entered") return `${record.entered_forename_raw} ${record.entered_school_raw}`;
  if (sortKey === "birth") return record.birth_month_year || record.roster_dob_iso || "";
  if (sortKey === "progress") return Number(record.progress ?? 0);
  if (sortKey === "score") return Number(record.accepted_score ?? -1);
  return "";
}

export function splitReasons(value: string) {
  return value ? value.split(";").filter(Boolean) : [];
}

export function queueLabel(queue: QueueName) {
  if (queue === "deferred") return "Deferred queue";
  if (queue === "ambiguous") return "Ambiguous queue";
  if (queue === "duplicate") return "Duplicate queue";
  return "Unreviewed queue";
}
