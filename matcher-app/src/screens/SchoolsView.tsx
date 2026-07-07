import { X } from "lucide-react";
import { useMemo, useState } from "react";
import type { SchoolSummary } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { asPercent } from "./workbenchUtils";

export function SchoolsView({ schools }: { schools: SchoolSummary[] }) {
  const [selectedName, setSelectedName] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(true);
  const sorted = useMemo(() => [...schools].sort((left, right) => left.school_raw.localeCompare(right.school_raw)), [schools]);
  const selected = sorted.find((school) => school.school_raw === selectedName) ?? sorted[0] ?? null;

  return (
    <section className={`grid min-h-0 flex-1 overflow-hidden p-4 ${detailsOpen ? "grid-cols-[minmax(0,1fr)_340px]" : "grid-cols-1"}`}>
      <Card className="min-h-0 gap-0 py-0">
        <CardHeader className="border-b border-border py-3">
          <CardTitle>Schools</CardTitle>
          <div className="text-[12px] text-muted">{schools.length} schools with roster records</div>
        </CardHeader>
        <CardContent className="min-h-0 overflow-auto p-0">
          <Table className="text-[13px]">
            <TableHeader className="sticky top-0 z-10 bg-mutedSurface">
              <TableRow>
                <TableHead>School</TableHead>
                <TableHead className="text-right">Roster</TableHead>
                <TableHead className="text-right">Matched</TableHead>
                <TableHead className="text-right">Responses</TableHead>
                <TableHead className="text-right">Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((school) => {
                const selectedRow = school.school_raw === selected?.school_raw;
                return (
                  <TableRow
                    key={school.school_raw}
                    data-state={selectedRow ? "selected" : undefined}
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedName(school.school_raw);
                      setDetailsOpen(true);
                    }}
                  >
                    <TableCell className="font-medium">{school.school_raw}</TableCell>
                    <TableCell className="text-right">{school.roster_count}</TableCell>
                    <TableCell className="text-right">{school.matched_count}</TableCell>
                    <TableCell className="text-right">{school.response_count}</TableCell>
                    <TableCell className="text-right">{asPercent(school.match_rate)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {detailsOpen ? (
        <aside className="ml-4 min-h-0 overflow-auto rounded-md border border-line bg-panel text-[13px]">
          <div className="flex items-center justify-between gap-3 border-b border-line p-4">
            <div className="min-w-0 truncate text-[15px] font-semibold">{selected?.school_raw ?? "No school selected"}</div>
            <Button variant="ghost" size="icon-sm" aria-label="Close details" title="Close details" onClick={() => setDetailsOpen(false)}>
              <X size={15} />
            </Button>
          </div>
          {selected ? (
            <div className="grid grid-cols-2 gap-3 p-4">
              <Metric label="Roster pupils" value={selected.roster_count} />
              <Metric label="Matched" value={selected.matched_count} />
              <Metric label="Available" value={selected.available_count} />
              <Metric label="Responses" value={selected.response_count} />
              <Metric label="Unresolved responses" value={selected.unresolved_response_count} />
              <Metric label="No candidates" value={selected.no_candidate_count} />
              <Metric label="Match rate" value={asPercent(selected.match_rate)} />
            </div>
          ) : null}
        </aside>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-line bg-background p-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
