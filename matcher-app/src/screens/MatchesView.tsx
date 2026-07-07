import { ArrowDownUp, CheckCircle2, Search, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { DecisionAction, ResponseDetailData, ReviewedRecord, Stats } from "@/types";
import type { MatchSortKey, MatchStatusFilter, SortDirection } from "@/app/types";
import { actionLabel, prettyConfidence, reviewedPupilName } from "@/app/matchUtils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { ResponseAnswerPanel } from "./ResponseAnswerPanel";
import { compactDate } from "./workbenchUtils";

export function MatchesView({
  records,
  totalRecords,
  loading,
  search,
  status,
  sortKey,
  sortDirection,
  stats,
  onSearchChange,
  onStatusChange,
  onSortChange,
  onLoadResponseDetail,
  onUndoDecision
}: {
  records: ReviewedRecord[];
  totalRecords: number;
  loading: boolean;
  search: string;
  status: MatchStatusFilter;
  sortKey: MatchSortKey;
  sortDirection: SortDirection;
  stats: Stats;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: MatchStatusFilter) => void;
  onSortChange: (value: MatchSortKey) => void;
  onLoadResponseDetail: (responseId: string) => Promise<ResponseDetailData | null>;
  onUndoDecision: (decisionId: number) => void;
}) {
  const [selectedDecisionId, setSelectedDecisionId] = useState<number | null>(null);
  const selectedRecord = useMemo(
    () => records.find((record) => record.decision_id === selectedDecisionId) ?? records[0] ?? null,
    [records, selectedDecisionId]
  );

  return (
    <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] overflow-hidden p-4">
      <Card className="h-full gap-0 py-0">
        <CardHeader className="border-b border-border py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Reviewed responses</CardTitle>
              <div className="mt-1 text-[12px] text-muted">
                {records.length} visible from {totalRecords} active decisions
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-[320px] max-w-full">
                <Search size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <Input
                  id="match-search"
                  className="pl-8"
                  value={search}
                  onChange={(event) => onSearchChange(event.target.value)}
                  placeholder="Search pupil, response, school, DOB"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(7.75rem,1fr))] gap-2 text-[13px]">
            <MatchCount label="Matched" value={stats.matched} active={status === "matched"} onClick={() => onStatusChange("matched")} />
            <MatchCount label="Deferred" value={stats.deferred} active={status === "deferred"} onClick={() => onStatusChange("deferred")} />
            <MatchCount label="Ambiguous" value={stats.ambiguous} active={status === "ambiguous"} onClick={() => onStatusChange("ambiguous")} />
            <MatchCount label="Duplicate" value={stats.duplicate} active={status === "duplicate"} onClick={() => onStatusChange("duplicate")} />
            <MatchCount label="No match" value={stats.noMatch} active={status === "no_match"} onClick={() => onStatusChange("no_match")} />
            <MatchCount label="All" value={totalRecords} active={status === "all"} onClick={() => onStatusChange("all")} />
          </div>
        </CardHeader>

        <CardContent className="min-h-0 flex-1 overflow-auto p-0">
          <Table className="min-w-[1120px] table-fixed text-[13px]">
            <colgroup>
              <col className="w-[90px]" />
              <col className="w-[160px]" />
              <col className="w-[185px]" />
              <col className="w-[210px]" />
              <col className="w-[86px]" />
              <col className="w-[72px]" />
              <col className="w-[74px]" />
              <col className="w-[153px]" />
              <col className="w-[90px]" />
            </colgroup>
            <TableHeader className="sticky top-0 z-10 bg-mutedSurface text-[12px] text-muted">
              <TableRow>
                <SortableTh label="Status" sortKey="status" activeSortKey={sortKey} direction={sortDirection} onSort={onSortChange} />
                <SortableTh label="Roster pupil" sortKey="pupil" activeSortKey={sortKey} direction={sortDirection} onSort={onSortChange} />
                <SortableTh label="Roster school" sortKey="school" activeSortKey={sortKey} direction={sortDirection} onSort={onSortChange} />
                <SortableTh label="Survey entry" sortKey="entered" activeSortKey={sortKey} direction={sortDirection} onSort={onSortChange} />
                <SortableTh label="Birth" sortKey="birth" activeSortKey={sortKey} direction={sortDirection} onSort={onSortChange} />
                <SortableTh label="Progress" sortKey="progress" activeSortKey={sortKey} direction={sortDirection} onSort={onSortChange} />
                <SortableTh label="Score" sortKey="score" activeSortKey={sortKey} direction={sortDirection} onSort={onSortChange} />
                <SortableTh label="Decision" sortKey="decided_at" activeSortKey={sortKey} direction={sortDirection} onSort={onSortChange} />
                <TableHead className="sticky right-0 w-[92px] border-l border-border bg-mutedSurface px-3 py-2">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell className="px-4 py-8 text-center text-muted" colSpan={9}>Loading reviewed records.</TableCell>
                </TableRow>
              ) : records.length ? (
                records.map((record) => (
                  <ReviewedRecordRow
                    key={record.decision_id}
                    record={record}
                    selected={record.decision_id === selectedRecord?.decision_id}
                    onSelect={() => setSelectedDecisionId(record.decision_id)}
                    onUndoDecision={onUndoDecision}
                  />
                ))
              ) : (
                <TableRow>
                  <TableCell className="px-4 py-8 text-center text-muted" colSpan={9}>No records match the current filter.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <MatchDetail record={selectedRecord} onLoadResponseDetail={onLoadResponseDetail} />
    </section>
  );
}

function MatchCount({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <Button variant={active ? "default" : "outline"} className="h-10 min-w-0 shrink justify-between gap-2 overflow-hidden" onClick={onClick}>
      <span className="min-w-0 truncate">{label}</span>
      <span className={`shrink-0 ${active ? "text-primary-foreground/75" : "text-muted"}`}>{value}</span>
    </Button>
  );
}

function SortableTh({
  label,
  sortKey,
  activeSortKey,
  direction,
  onSort
}: {
  label: string;
  sortKey: MatchSortKey;
  activeSortKey: MatchSortKey;
  direction: SortDirection;
  onSort: (value: MatchSortKey) => void;
}) {
  const active = sortKey === activeSortKey;
  return (
    <TableHead className="px-3 py-2">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 h-7 px-2 text-[12px] font-medium"
        title={active ? `Sorted ${direction}` : `Sort by ${label}`}
        onClick={() => onSort(sortKey)}
      >
        {label}
        <ArrowDownUp size={13} className={active ? "text-foreground" : "text-muted"} />
      </Button>
    </TableHead>
  );
}

function ReviewedRecordRow({
  record,
  selected,
  onSelect,
  onUndoDecision
}: {
  record: ReviewedRecord;
  selected: boolean;
  onSelect: () => void;
  onUndoDecision: (decisionId: number) => void;
}) {
  const pupilName = reviewedPupilName(record);
  const score = record.accepted_score === null || record.accepted_score === undefined ? "" : Number(record.accepted_score).toFixed(1);
  const confidence = record.accepted_confidence || record.top_confidence || "";
  return (
    <TableRow data-state={selected ? "selected" : undefined} className="group cursor-pointer align-top" onClick={onSelect}>
      <TableCell className="px-3 py-3">
        <DecisionStatus action={record.action} />
      </TableCell>
      <TableCell className="max-w-0 px-3 py-3">
        <div className="truncate font-medium">{pupilName}</div>
        <div className="mt-1 truncate font-mono text-[11px] text-muted">{record.response_id}</div>
      </TableCell>
      <TableCell className="max-w-0 px-3 py-3">
        <div className="truncate" title={record.roster_school || "No roster school"}>{record.roster_school || "No roster school"}</div>
        <div className="mt-1 text-[12px] text-muted">{record.roster_dob_iso || "DOB missing"}</div>
      </TableCell>
      <TableCell className="max-w-0 px-3 py-3">
        <div className="truncate font-medium">{record.entered_forename_raw || "Blank name"}</div>
        <div className="mt-1 truncate text-[12px] text-muted" title={record.entered_school_raw || "Blank school"}>{record.entered_school_raw || "Blank school"}</div>
      </TableCell>
      <TableCell className="whitespace-nowrap px-3 py-3">
        <div>{record.birth_month_year || "Missing"}</div>
        <div className="mt-1 text-[12px] text-muted">survey</div>
      </TableCell>
      <TableCell className="whitespace-nowrap px-3 py-3">{record.progress}%</TableCell>
      <TableCell className="whitespace-nowrap px-3 py-3">
        <div className="font-medium">{score || "Manual"}</div>
        <div className="mt-1 text-[12px] text-muted">{prettyConfidence(confidence)}</div>
      </TableCell>
      <TableCell className="whitespace-nowrap px-3 py-3">
        <div>{record.decided_at.replace("T", " ").slice(0, 19)}</div>
        <div className="mt-1 text-[12px] text-muted">survey {record.recorded_date_raw}</div>
      </TableCell>
      <TableCell className={`sticky right-0 border-l border-border px-3 py-3 ${selected ? "bg-muted" : "bg-card group-hover:bg-muted/50"}`}>
        <Button
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onUndoDecision(record.decision_id);
          }}
        >
          <Undo2 size={14} /> Reopen
        </Button>
      </TableCell>
    </TableRow>
  );
}

function MatchDetail({
  record,
  onLoadResponseDetail
}: {
  record: ReviewedRecord | null;
  onLoadResponseDetail: (responseId: string) => Promise<ResponseDetailData | null>;
}) {
  const pupilName = record ? reviewedPupilName(record) : "";
  return (
    <aside className="ml-4 flex min-h-0 flex-col overflow-hidden rounded-md border border-line bg-panel text-[13px]">
      <div className="border-b border-line p-4">
        <div className="text-[15px] font-semibold">{record ? pupilName || record.response_id : "No decision selected"}</div>
      </div>
      <div className="min-h-0 overflow-auto p-4">
        {record ? (
          <div className="space-y-3">
            <Detail label="Status" value={actionLabel(record.action)} />
            <Detail label="Response ID" value={record.response_id} />
            <Detail label="Survey entry" value={`${record.entered_forename_raw || "Blank"} at ${record.entered_school_raw || "Blank school"}`} />
            <Detail label="Birth month/year" value={record.birth_month_year || "Missing"} />
            <Detail label="Roster link" value={pupilName || "None"} />
            <Detail label="Roster school" value={record.roster_school || "None"} />
            <Detail label="Decided at" value={compactDate(record.decided_at)} />
          </div>
        ) : null}
        <ResponseAnswerPanel responseId={record?.response_id} onLoadResponseDetail={onLoadResponseDetail} />
      </div>
    </aside>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-0.5 break-words font-medium">{value || ""}</div>
    </div>
  );
}

function DecisionStatus({ action }: { action: DecisionAction }) {
  if (action === "matched") {
    return (
      <Badge variant="secondary" className="border-0 bg-success/10 text-success">
        <CheckCircle2 size={15} /> Matched
      </Badge>
    );
  }
  if (action === "duplicate") return <Badge variant="secondary" className="border-0 bg-muted text-muted-foreground">Duplicate</Badge>;
  if (action === "no_match") return <Badge variant="secondary" className="border-0 bg-destructive/10 text-destructive">No match</Badge>;
  if (action === "ambiguous") return <Badge variant="secondary" className="border-0 bg-warning/10 text-warning">Ambiguous</Badge>;
  return <Badge variant="secondary" className="border-0 bg-muted text-muted-foreground">Deferred</Badge>;
}
