import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ResponseDetailData, ResponseRecord, RosterSchool } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResponseAnswerPanel } from "./ResponseAnswerPanel";
import { compactDate, includesText } from "./workbenchUtils";

export function ResponsesView({
  responses,
  schools,
  onLoadResponseDetail
}: {
  responses: ResponseRecord[];
  schools: RosterSchool[];
  onLoadResponseDetail: (responseId: string) => Promise<ResponseDetailData | null>;
}) {
  const [query, setQuery] = useState("");
  const [school, setSchool] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string>("");
  const [detailsOpen, setDetailsOpen] = useState(true);

  const filtered = useMemo(
    () =>
      responses.filter((response) => {
        if (school !== "all" && response.entered_school_raw !== school) return false;
        if (status !== "all" && response.status !== status) return false;
        return includesText([response.response_id, response.entered_forename_raw, response.entered_school_raw, response.birth_month_year, response.roster_forename, response.roster_surname], query);
      }),
    [query, responses, school, status]
  );
  const selected = filtered.find((response) => response.response_id === selectedId) ?? filtered[0] ?? null;

  return (
    <section className={`grid min-h-0 flex-1 overflow-hidden p-4 ${detailsOpen ? "grid-cols-[minmax(0,1fr)_360px]" : "grid-cols-1"}`}>
      <Card className="min-h-0 gap-0 py-0">
        <CardHeader className="border-b border-border py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Responses</CardTitle>
              <div className="mt-1 text-[12px] text-muted">{filtered.length} visible from {responses.length} responses</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-[260px]">
                <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <Input className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search responses" />
              </div>
              <Select value={school} onValueChange={setSchool}>
                <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All schools</SelectItem>
                  {schools.map((item) => <SelectItem key={item.school_raw} value={item.school_raw}>{item.school_raw}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="unreviewed">Unreviewed</SelectItem>
                  <SelectItem value="matched">Matched</SelectItem>
                  <SelectItem value="deferred">Deferred</SelectItem>
                  <SelectItem value="ambiguous">Ambiguous</SelectItem>
                  <SelectItem value="duplicate">Duplicate</SelectItem>
                  <SelectItem value="no_match">No match</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 overflow-auto p-0">
          <Table className="min-w-[980px] text-[13px]">
            <TableHeader className="sticky top-0 z-10 bg-mutedSurface">
              <TableRow>
                <TableHead>Response</TableHead>
                <TableHead>Entered name</TableHead>
                <TableHead>Entered school</TableHead>
                <TableHead>Birth</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Top candidate</TableHead>
                <TableHead className="text-right">Progress</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((response) => {
                const selectedRow = response.response_id === selected?.response_id;
                return (
                <TableRow
                  key={response.response_id}
                  data-state={selectedRow ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => {
                    setSelectedId(response.response_id);
                    setDetailsOpen(true);
                  }}
                >
                  <TableCell className="font-mono text-[12px]">{response.response_id}</TableCell>
                  <TableCell className="font-medium">{response.entered_forename_raw || "Blank"}</TableCell>
                  <TableCell>{response.entered_school_raw || "Blank"}</TableCell>
                  <TableCell>{response.birth_month_year || "Missing"}</TableCell>
                  <TableCell><Badge variant={response.status === "matched" ? "secondary" : "outline"}>{response.status.replace("_", " ")}</Badge></TableCell>
                  <TableCell>{response.top_confidence}</TableCell>
                  <TableCell className="text-right">{response.progress}%</TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {detailsOpen ? (
        <ResponseDetail
          response={selected}
          onClose={() => setDetailsOpen(false)}
          onLoadResponseDetail={onLoadResponseDetail}
        />
      ) : null}
    </section>
  );
}

function ResponseDetail({
  response,
  onClose,
  onLoadResponseDetail
}: {
  response: ResponseRecord | null;
  onClose: () => void;
  onLoadResponseDetail: (responseId: string) => Promise<ResponseDetailData | null>;
}) {
  return (
    <aside className="ml-4 flex min-h-0 flex-col overflow-hidden rounded-md border border-line bg-panel text-[13px]">
      <div className="flex items-center justify-between gap-3 border-b border-line p-4">
        <div className="min-w-0 truncate text-[15px] font-semibold">{response ? response.entered_forename_raw || response.response_id : "No response selected"}</div>
        <Button variant="ghost" size="icon-sm" aria-label="Close details" title="Close details" onClick={onClose}>
          <X size={15} />
        </Button>
      </div>
      <div className="min-h-0 overflow-auto p-4">
        {response ? (
          <div className="space-y-3">
            <Detail label="Response ID" value={response.response_id} />
            <Detail label="Status" value={response.status.replace("_", " ")} />
            <Detail label="Entered school" value={response.entered_school_raw || "Blank"} />
            <Detail label="Birth month/year" value={response.birth_month_year || "Missing"} />
            <Detail label="Recorded" value={response.recorded_date_raw} />
            <Detail label="Progress" value={`${response.progress}%`} />
            <Detail label="Response class" value={response.response_class.replaceAll("_", " ")} />
            <Detail label="Candidates" value={`${response.candidate_count} generated, top ${response.top_confidence}`} />
            <Detail label="Roster link" value={response.roster_child_id ? `${response.roster_forename ?? ""} ${response.roster_surname ?? ""}`.trim() : "None"} />
            <Detail label="Decided at" value={compactDate(response.decided_at)} />
          </div>
        ) : null}
        <ResponseAnswerPanel responseId={response?.response_id} onLoadResponseDetail={onLoadResponseDetail} />
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
