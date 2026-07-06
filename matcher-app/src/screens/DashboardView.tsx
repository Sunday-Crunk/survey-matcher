import { ClipboardList, CornerDownLeft, FileUp, Table2 } from "lucide-react";
import type { RosterSchool, Stats } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function DashboardView({
  stats,
  schools,
  onOpenReview,
  onOpenMatches,
  onOpenImports
}: {
  stats: Stats;
  schools: RosterSchool[];
  onOpenReview: () => void;
  onOpenMatches: () => void;
  onOpenImports: () => void;
}) {
  const completionPercent = stats.reviewable ? Math.round((stats.matched / stats.reviewable) * 100) : 0;
  const openIssues = stats.deferred + stats.ambiguous + stats.duplicate + stats.noMatch;
  const largestSchools = [...schools].sort((left, right) => right.roster_count - left.roster_count).slice(0, 8);

  return (
    <section className="min-h-0 flex-1 overflow-auto p-4">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DashboardMetric label="Matched" value={stats.matched} detail={`${completionPercent}% of reviewable`} />
          <DashboardMetric label="Unreviewed" value={stats.unreviewed} detail="Awaiting decision" />
          <DashboardMetric label="Roster pupils" value={stats.rosterChildren} detail={`${schools.length} schools`} />
          <DashboardMetric label="Open decisions" value={openIssues} detail="Deferred, ambiguous, duplicate, no match" />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
                <CardTitle>Review queues</CardTitle>
                <Button variant="outline" onClick={onOpenReview}>
                  <ClipboardList size={16} /> Open queue
                </Button>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <QueueSummary label="Unreviewed" value={stats.unreviewed} />
                <QueueSummary label="Deferred" value={stats.deferred} />
                <QueueSummary label="Ambiguous" value={stats.ambiguous} />
                <QueueSummary label="Duplicate" value={stats.duplicate} />
                <QueueSummary label="No match" value={stats.noMatch} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle>School roster volume</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="data-table w-full text-left text-[13px]">
                  <thead className="bg-mutedSurface text-muted">
                    <tr>
                      <th className="px-4 py-2 font-medium">School</th>
                      <th className="w-[110px] px-4 py-2 text-right font-medium">Roster</th>
                    </tr>
                  </thead>
                  <tbody>
                    {largestSchools.map((school) => (
                      <tr key={school.school_raw} className="hover:bg-mutedSurface/60">
                        <td className="px-4 py-2">{school.school_raw}</td>
                        <td className="px-4 py-2 text-right font-medium">{school.roster_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Next actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button className="w-full justify-start" onClick={onOpenReview}>
                  <CornerDownLeft size={16} /> Continue matching
                </Button>
                <Button variant="outline" className="w-full justify-start" onClick={onOpenMatches}>
                  <Table2 size={16} /> Inspect matched data
                </Button>
                <Button variant="outline" className="w-full justify-start" onClick={onOpenImports}>
                  <FileUp size={16} /> Import Qualtrics export
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Data quality</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-[13px]">
                <QualityLine label="Generated high preselects" value={stats.preselected} variant="success" />
                <QualityLine label="Responses with no candidate" value={stats.noCandidate} variant={stats.noCandidate ? "warning" : "success"} />
                <QualityLine label="Duplicate queue" value={stats.duplicate} variant={stats.duplicate ? "warning" : "success"} />
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </section>
  );
}

function DashboardMetric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[13px] text-muted">{label}</div>
        <div className="mt-2 text-2xl font-semibold">{value}</div>
        <div className="mt-1 text-[12px] text-muted">{detail}</div>
      </CardContent>
    </Card>
  );
}

function QueueSummary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function QualityLine({ label, value, variant }: { label: string; value: number; variant: "success" | "warning" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <Badge
        variant="outline"
        className={variant === "success" ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning"}
      >
        {value}
      </Badge>
    </div>
  );
}
