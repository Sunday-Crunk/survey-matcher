import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { PupilRecord, RosterSchool } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { compactDate, includesText } from "./workbenchUtils";

export function PupilsView({ pupils, schools }: { pupils: PupilRecord[]; schools: RosterSchool[] }) {
  const [query, setQuery] = useState("");
  const [school, setSchool] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string>("");

  const filtered = useMemo(
    () =>
      pupils.filter((pupil) => {
        if (school !== "all" && pupil.school_raw !== school) return false;
        if (status !== "all" && pupil.status !== status) return false;
        return includesText([pupil.forename_raw, pupil.surname_raw, pupil.school_raw, pupil.dob_iso, pupil.matched_response_id], query);
      }),
    [pupils, query, school, status]
  );
  const selected = pupils.find((pupil) => pupil.roster_child_id === selectedId) ?? filtered[0] ?? null;

  return (
    <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] overflow-hidden p-4">
      <Card className="min-h-0 gap-0 py-0">
        <CardHeader className="border-b border-border py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Pupils</CardTitle>
              <div className="mt-1 text-[12px] text-muted">{filtered.length} visible from {pupils.length} roster pupils</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-[260px]">
                <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <Input className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pupils" />
              </div>
              <Select value={school} onValueChange={setSchool}>
                <SelectTrigger className="w-[220px]"><SelectValue placeholder="School" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All schools</SelectItem>
                  {schools.map((item) => <SelectItem key={item.school_raw} value={item.school_raw}>{item.school_raw}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="matched">Matched</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 overflow-auto p-0">
          <Table className="min-w-[900px] text-[13px]">
            <TableHeader className="sticky top-0 z-10 bg-mutedSurface">
              <TableRow>
                <TableHead>Pupil</TableHead>
                <TableHead>School</TableHead>
                <TableHead>DOB</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Matched response</TableHead>
                <TableHead className="text-right">Candidates</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((pupil) => (
                <TableRow key={pupil.roster_child_id} className="cursor-pointer" onClick={() => setSelectedId(pupil.roster_child_id)}>
                  <TableCell className="font-medium">{pupil.forename_raw} {pupil.surname_raw}</TableCell>
                  <TableCell>{pupil.school_raw}</TableCell>
                  <TableCell>{pupil.dob_iso || "Missing"}</TableCell>
                  <TableCell><StatusBadge status={pupil.status} /></TableCell>
                  <TableCell className="font-mono text-[12px]">{pupil.matched_response_id || ""}</TableCell>
                  <TableCell className="text-right">{pupil.candidate_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <PupilDetail pupil={selected} />
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === "matched" ? "secondary" : "outline"}>{status}</Badge>;
}

function PupilDetail({ pupil }: { pupil: PupilRecord | null }) {
  return (
    <aside className="ml-4 min-h-0 overflow-auto rounded-md border border-line bg-panel p-4 text-[13px]">
      <div className="text-[15px] font-semibold">{pupil ? `${pupil.forename_raw} ${pupil.surname_raw}` : "No pupil selected"}</div>
      {pupil ? (
        <div className="mt-4 space-y-3">
          <Detail label="School" value={pupil.school_raw} />
          <Detail label="DOB" value={pupil.dob_iso || "Missing"} />
          <Detail label="Status" value={pupil.status} />
          <Detail label="Matched response" value={pupil.matched_response_id || "Not matched"} />
          <Detail label="Matched at" value={compactDate(pupil.matched_at)} />
          <Detail label="Roster source" value={`${pupil.roster_file} row ${pupil.source_row}`} />
          <Detail label="Candidate references" value={String(pupil.candidate_count)} />
        </div>
      ) : null}
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
