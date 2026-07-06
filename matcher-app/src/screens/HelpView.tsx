import { BookOpen, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type HelpEntry = {
  term: string;
  detail: string;
};

type HelpSection = {
  id: string;
  title: string;
  summary: string;
  entries: HelpEntry[];
};

const helpSections: HelpSection[] = [
  {
    id: "overview",
    title: "How the app works",
    summary: "The matcher links survey responses to roster pupils while keeping every decision auditable.",
    entries: [
      { term: "Main job", detail: "Review each Qualtrics response, compare it with generated roster candidates, and record a reviewer decision." },
      { term: "Source data", detail: "Roster pupils, survey responses, and generated candidates are brought into the app for review." },
      { term: "Reviewer decisions", detail: "Accept match, defer, no match, ambiguous, and duplicate are active decisions. Reopening a row preserves the old decision history." },
      { term: "Accountability", detail: "Signed-in actions such as decisions, reopens, imports, exports, and roster additions appear in the audit log." }
    ]
  },
  {
    id: "dashboard",
    title: "Dashboard",
    summary: "Use Dashboard for the current operating picture before jumping into review or exports.",
    entries: [
      { term: "Matched count", detail: "Number of reviewable responses currently linked to roster pupils." },
      { term: "Open decisions", detail: "Deferred, ambiguous, duplicate, and no-match rows that may need later inspection or export." },
      { term: "School roster volume", detail: "Quick scan of schools represented in the roster and response data." },
      { term: "Next actions", detail: "Shortcuts into the queue, matched data, and import flow." }
    ]
  },
  {
    id: "match-queue",
    title: "Match queue",
    summary: "The queue is the main decision workspace for one response at a time.",
    entries: [
      { term: "Unreviewed", detail: "Responses with no active decision. This is the default queue." },
      { term: "Deferred", detail: "Use when a response needs more information or should be handled later." },
      { term: "Ambiguous", detail: "Use when multiple pupils could plausibly be the same child." },
      { term: "Duplicate", detail: "Use when this response is another submission from a pupil already represented by another response." },
      { term: "Candidate evidence", detail: "Scores and reason codes are evidence, not an automatic decision. Check school, name, DOB, and already-matched warnings." },
      { term: "Roster search", detail: "Search the roster when generated candidates do not include the correct pupil." },
      { term: "Add pupil", detail: "Add a roster pupil only when the roster is missing them. The addition is recorded and audited." }
    ]
  },
  {
    id: "workbench-pages",
    title: "Workbench pages",
    summary: "The workbench pages expose the data without making reviewers go back to spreadsheets.",
    entries: [
      { term: "Pupils", detail: "Roster pupil list with school/status filtering and detail inspection." },
      { term: "Responses", detail: "Survey response list with status, school, candidate, and linked roster information." },
      { term: "Matches", detail: "All active decisions with search, sorting, and reopen controls." },
      { term: "Schools", detail: "School-level roster, response, match, unresolved, and no-candidate totals." },
      { term: "Data quality", detail: "Issues such as no-candidate responses, multiple high-confidence candidates, missing DOBs, and low school coverage." },
      { term: "Audit", detail: "Decision, reopen, import, export, and roster-addition activity with names and timestamps where available." }
    ]
  },
  {
    id: "imports-exports",
    title: "Imports and exports",
    summary: "Imports preserve source files and exports are generated from the current app data.",
    entries: [
      { term: "Raw Qualtrics import", detail: "Upload a Qualtrics CSV or ZIP. Existing response IDs are skipped and existing decisions are preserved." },
      { term: "Import backups", detail: "Before processed files are replaced, the app keeps a backup in the app data folder." },
      { term: "Matched export", detail: "Primary pupil-response export for active accepted matches." },
      { term: "Coverage export", detail: "Roster coverage export showing which pupils have an active linked response." },
      { term: "Unresolved exports", detail: "Separate exports keep deferred, ambiguous, duplicate, no-match, unmatched pupils, and unresolved responses visible." },
      { term: "Audit export", detail: "CSV copy of the audit log." }
    ]
  },
  {
    id: "decisions-conflicts",
    title: "Decisions and conflicts",
    summary: "Decisions are explicit, auditable, and protected from accidental overwrites.",
    entries: [
      { term: "One active decision", detail: "A response can have only one active decision at a time." },
      { term: "One active match", detail: "A roster pupil can have only one active accepted match at a time." },
      { term: "Revision", detail: "Changing an existing active decision must be explicit. The old decision is reopened and a new decision is recorded." },
      { term: "Collision message", detail: "If someone else has already decided the response or matched the pupil, the app shows a conflict message and the queue should be refreshed." },
      { term: "Undo/Reopen", detail: "Undo reverses the latest active decision. Reopen in Matches reverses a specific active decision." }
    ]
  },
  {
    id: "accounts-audit",
    title: "Sign-in and audit",
    summary: "Sign-in keeps review work attributable and easier to check later.",
    entries: [
      { term: "Sign in", detail: "Use your assigned username and password before reviewing data." },
      { term: "Signed-in name", detail: "Your name is recorded when you make or reopen decisions, add roster pupils, import files, or export CSVs." },
      { term: "Audit log", detail: "Use Audit to check who changed what, when it happened, and which response or pupil was involved." }
    ]
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    summary: "Queue shortcuts are there for repeated review work.",
    entries: [
      { term: "Enter", detail: "Accept the selected match." },
      { term: "Up / Down", detail: "Move between generated candidates." },
      { term: "/", detail: "Focus roster search." },
      { term: "D", detail: "Mark deferred." },
      { term: "N", detail: "Mark no roster match." },
      { term: "A", detail: "Mark ambiguous." },
      { term: "R", detail: "Mark duplicate response." },
      { term: "U", detail: "Undo latest decision." }
    ]
  }
];

export function HelpView() {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSections = useMemo(() => {
    if (!normalizedQuery) return helpSections;
    return helpSections
      .map((section) => ({
        ...section,
        entries: section.entries.filter((entry) =>
          [section.title, section.summary, entry.term, entry.detail].join(" ").toLowerCase().includes(normalizedQuery)
        )
      }))
      .filter((section) => section.entries.length > 0);
  }, [normalizedQuery]);

  return (
    <section className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] overflow-hidden p-5">
      <aside className="min-h-0 overflow-auto border-r border-line pr-4 text-[13px]">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search help" />
        </div>
        <nav className="mt-4 space-y-1">
          {helpSections.map((section) => (
            <a key={section.id} className="block rounded-md px-2 py-1.5 text-muted hover:bg-mutedSurface hover:text-foreground" href={`#${section.id}`}>
              {section.title}
            </a>
          ))}
        </nav>
      </aside>

      <div className="min-h-0 overflow-auto pl-5">
        <div className="mb-4 flex items-center gap-2">
          <BookOpen size={18} />
          <div>
            <h1 className="text-[18px] font-semibold">Help</h1>
            <div className="mt-1 text-[13px] text-muted">App guide, page reference, workflow rules, and audit behaviour.</div>
          </div>
        </div>

        <div className="space-y-4">
          {visibleSections.length ? visibleSections.map((section) => (
            <Card key={section.id} id={section.id} className="scroll-mt-5">
              <CardHeader className="border-b border-line pb-3">
                <CardTitle>{section.title}</CardTitle>
                <div className="text-[13px] text-muted">{section.summary}</div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-line">
                  {section.entries.map((entry) => (
                    <div key={entry.term} className="grid grid-cols-[190px_minmax(0,1fr)] gap-4 px-4 py-3 text-[13px]">
                      <div className="font-medium text-foreground">{entry.term}</div>
                      <div className="leading-5 text-muted">{entry.detail}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )) : (
            <Card>
              <CardContent className="py-6 text-[13px] text-muted">No help entries match that search.</CardContent>
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}
