import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { AuditEvent, ImportHistoryRecord } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { compactDate, includesText } from "./workbenchUtils";

export function AuditView({ events, imports }: { events: AuditEvent[]; imports: ImportHistoryRecord[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => events.filter((event) => includesText([event.event_type, event.actor, event.subject, event.detail, event.response_id, event.roster_child_id], query)),
    [events, query]
  );

  return (
    <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] overflow-hidden p-4">
      <Card className="min-h-0 gap-0 py-0">
        <CardHeader className="border-b border-border py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Audit log</CardTitle>
              <div className="mt-1 text-[12px] text-muted">{filtered.length} visible from {events.length} events</div>
            </div>
            <div className="relative w-[300px]">
              <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <Input className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search audit events" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 overflow-auto p-0">
          <Table className="min-w-[920px] text-[13px]">
            <TableHeader className="sticky top-0 z-10 bg-mutedSurface">
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Record</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap">{compactDate(event.occurred_at)}</TableCell>
                  <TableCell><Badge variant="outline">{event.event_type.replaceAll("_", " ")}</Badge></TableCell>
                  <TableCell className="font-medium">{event.subject}</TableCell>
                  <TableCell>{event.detail}</TableCell>
                  <TableCell className="font-mono text-[12px]">{event.response_id || event.roster_child_id || ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <aside className="ml-4 min-h-0 overflow-auto rounded-md border border-line bg-panel p-4 text-[13px]">
        <div className="text-[15px] font-semibold">Import history</div>
        <div className="mt-4 space-y-3">
          {imports.length ? imports.map((item) => (
            <div key={item.id} className="min-w-0 rounded-md border border-line bg-background p-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="max-w-full truncate font-medium">{item.raw_upload || item.id}</div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[360px] break-all">
                  {item.raw_upload || item.id}
                </TooltipContent>
              </Tooltip>
              <div className="mt-1 text-[12px] text-muted">{item.id}</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                <Metric label="Survey rows" value={item.survey_rows ?? ""} />
                <Metric label="Candidates" value={item.candidate_rows ?? ""} />
              </div>
            </div>
          )) : <div className="text-muted">No raw import records found.</div>}
        </div>
      </aside>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-muted">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
