import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { DataQualityIssue, RosterSchool } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { includesText } from "./workbenchUtils";

export function DataQualityView({ issues, schools }: { issues: DataQualityIssue[]; schools: RosterSchool[] }) {
  const [query, setQuery] = useState("");
  const [school, setSchool] = useState("all");
  const [category, setCategory] = useState("all");
  const categories = useMemo(() => [...new Set(issues.map((issue) => issue.category))].sort(), [issues]);
  const filtered = useMemo(
    () =>
      issues.filter((issue) => {
        if (school !== "all" && issue.school_raw !== school) return false;
        if (category !== "all" && issue.category !== category) return false;
        return includesText([issue.category, issue.subject, issue.school_raw, issue.detail, issue.response_id, issue.roster_child_id], query);
      }),
    [category, issues, query, school]
  );

  return (
    <section className="min-h-0 flex-1 overflow-hidden p-4">
      <Card className="h-full gap-0 py-0">
        <CardHeader className="border-b border-border py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Data quality</CardTitle>
              <div className="mt-1 text-[12px] text-muted">{filtered.length} visible from {issues.length} checks</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-[260px]">
                <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <Input className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search issues" />
              </div>
              <Select value={school} onValueChange={setSchool}>
                <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All schools</SelectItem>
                  {schools.map((item) => <SelectItem key={item.school_raw} value={item.school_raw}>{item.school_raw}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 overflow-auto p-0">
          <Table className="min-w-[980px] text-[13px]">
            <TableHeader className="sticky top-0 z-10 bg-mutedSurface">
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>School</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Related record</TableHead>
                <TableHead>Severity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell className="font-medium">{issue.category}</TableCell>
                  <TableCell>{issue.subject}</TableCell>
                  <TableCell>{issue.school_raw}</TableCell>
                  <TableCell>{issue.detail}</TableCell>
                  <TableCell className="font-mono text-[12px]">{issue.response_id || issue.roster_child_id || ""}</TableCell>
                  <TableCell><Badge variant={issue.severity === "warning" ? "secondary" : "outline"}>{issue.severity}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}
