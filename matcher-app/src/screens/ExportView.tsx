import { Download } from "lucide-react";
import { useState } from "react";
import type { ExportCsvResult, Stats } from "@/types";
import { Button } from "@/components/ui/button";

export function ExportView({
  stats,
  exportingMatched,
  exportingCoverage,
  result,
  onExportMatched,
  onExportCoverage
}: {
  stats: Stats;
  exportingMatched: boolean;
  exportingCoverage: boolean;
  result: ExportCsvResult | null;
  onExportMatched: () => void;
  onExportCoverage: () => void;
}) {
  const [downloading, setDownloading] = useState("");
  const catalogue = [
    {
      key: "matched",
      title: "Matched pupil-response full export",
      detail: "Accepted matches with roster fields, match evidence, and Qualtrics response columns.",
      count: `${stats.matched} matched rows`,
      action: onExportMatched,
      disabled: exportingMatched || exportingCoverage
    },
    {
      key: "coverage",
      title: "Roster coverage export",
      detail: "Every roster pupil with current matched response status and accepted match evidence.",
      count: `${stats.rosterChildren} roster rows`,
      action: onExportCoverage,
      disabled: exportingMatched || exportingCoverage
    },
    {
      key: "unmatched-pupils",
      title: "Unmatched roster pupils",
      detail: "Roster pupils without an active accepted match.",
      count: `${Math.max(0, stats.rosterChildren - stats.matched)} pupil rows`,
      path: "export/unmatched-pupils",
      filename: "unmatched_roster_pupils.csv"
    },
    {
      key: "unresolved-responses",
      title: "Unmatched or unresolved responses",
      detail: "Unreviewed, deferred, ambiguous, duplicate, and no-match response rows.",
      count: `${stats.unreviewed + stats.deferred + stats.ambiguous + stats.duplicate + stats.noMatch} response rows`,
      path: "export/unresolved-responses",
      filename: "unresolved_responses.csv"
    },
    { key: "ambiguous", title: "Ambiguous decisions", detail: "All active ambiguous decisions.", count: `${stats.ambiguous} rows`, path: "export/ambiguous-decisions", filename: "ambiguous_decisions.csv" },
    { key: "deferred", title: "Deferred decisions", detail: "All active deferred decisions.", count: `${stats.deferred} rows`, path: "export/deferred-decisions", filename: "deferred_decisions.csv" },
    { key: "duplicate", title: "Duplicate response decisions", detail: "All active duplicate-response decisions.", count: `${stats.duplicate} rows`, path: "export/duplicate-decisions", filename: "duplicate_response_decisions.csv" },
    { key: "no-match", title: "No-match decisions", detail: "All active responses marked as no roster match.", count: `${stats.noMatch} rows`, path: "export/no-match-decisions", filename: "no_match_decisions.csv" },
    { key: "audit", title: "Full audit log", detail: "Decision and roster-addition audit events available in local data.", count: "Audit rows", path: "export/audit-log", filename: "audit_log.csv" },
    { key: "school-progress", title: "School-level progress summary", detail: "Roster, match, response, unresolved, and no-candidate counts by school.", count: "School rows", path: "export/school-progress", filename: "school_progress_summary.csv" }
  ];

  const downloadCatalogueExport = async (path: string, filename: string, key: string) => {
    setDownloading(key);
    try {
      const response = await fetch(`/api/${path}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`Export failed: ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setDownloading("");
    }
  };

  return (
    <section className="min-h-0 flex-1 overflow-auto p-5">
      <div className="max-w-[980px] rounded-md border border-line bg-panel">
        <div className="border-b border-line p-4">
          <div className="text-[15px] font-semibold">Export CSVs</div>
          <div className="mt-1 max-w-[740px] text-[13px] text-muted">
            Create spreadsheet-ready files from the current active decisions and roster state.
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
          {catalogue.map((item) => (
            <ExportAction
              key={item.key}
              title={item.title}
              detail={item.detail}
              count={item.count}
              buttonLabel={downloading === item.key || (item.key === "matched" && exportingMatched) || (item.key === "coverage" && exportingCoverage) ? "Exporting" : "Export CSV"}
              disabled={Boolean(item.disabled) || Boolean(downloading)}
              onClick={() => item.action ? item.action() : void downloadCatalogueExport(item.path, item.filename, item.key)}
            />
          ))}
        </div>

        {result?.ok ? (
          <div className="border-t border-line bg-[#fbfaf7] px-4 py-3 text-[13px]">
            <div className="font-medium text-accent">Export complete</div>
            <div className="mt-1 text-muted">{result.rows} rows saved to {result.filePath}</div>
          </div>
        ) : result?.cancelled ? (
          <div className="border-t border-line px-4 py-3 text-[13px] text-muted">Export cancelled.</div>
        ) : null}
      </div>
    </section>
  );
}

function ExportAction({
  title,
  detail,
  count,
  buttonLabel,
  disabled,
  onClick
}: {
  title: string;
  detail: string;
  count: string;
  buttonLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="rounded-md border border-line bg-[#fbfaf7] p-4 text-[13px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold">{title}</div>
          <div className="mt-1 text-[12px] text-muted">{count}</div>
        </div>
        <Download size={18} className="mt-0.5 text-muted" />
      </div>
      <div className="mt-3 min-h-[60px] text-muted">{detail}</div>
      <Button className="mt-4 h-10 w-full" onClick={onClick} disabled={disabled}>
        <Download size={17} /> {buttonLabel}
      </Button>
    </div>
  );
}
