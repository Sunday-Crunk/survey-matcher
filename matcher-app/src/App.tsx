import {
  ClipboardList,
  Database,
  Download,
  FileUp,
  HelpCircle,
  ListRestart,
  LayoutDashboard,
  Moon,
  RefreshCw,
  School,
  ShieldCheck,
  Sun,
  Table2,
  Undo2,
  Users
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type {
  AuditEvent,
  AuthUser,
  Candidate,
  DataQualityIssue,
  DecisionAction,
  ExportCsvResult,
  ImportProcessedSourceResult,
  ImportHistoryRecord,
  PupilRecord,
  QueueName,
  ReviewedRecord,
  RosterSchool,
  RosterSearchResult,
  ResponseRecord,
  SchoolSummary,
  Stats,
  SurveyResponse
} from "./types";
import { createMatcherApi } from "./httpMatcher";
import type { AddPupilFormState, MatchSortKey, MatchStatusFilter, SortDirection, ViewName } from "@/app/types";
import { actionLabel, cls, queueLabel, reviewedPupilName, reviewedSortValue } from "@/app/matchUtils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DashboardView } from "@/screens/DashboardView";
import { AuditView } from "@/screens/AuditView";
import { DataQualityView } from "@/screens/DataQualityView";
import { ExportView } from "@/screens/ExportView";
import { HelpView } from "@/screens/HelpView";
import { ImportSourceView } from "@/screens/ImportSourceView";
import { MatchesView } from "@/screens/MatchesView";
import { PupilsView } from "@/screens/PupilsView";
import { ResponsesView } from "@/screens/ResponsesView";
import { ReviewView } from "@/screens/ReviewView";
import { SchoolsView } from "@/screens/SchoolsView";

const emptyStats: Stats = {
  responseCount: 0,
  reviewable: 0,
  unreviewed: 0,
  matched: 0,
  deferred: 0,
  noMatch: 0,
  ambiguous: 0,
  duplicate: 0,
  preselected: 0,
  noCandidate: 0,
  rosterChildren: 0
};

const emptyAddPupilForm: AddPupilFormState = {
  schoolRaw: "",
  forenameRaw: "",
  surnameRaw: "",
  dobIso: "",
  sex: "",
  upn: ""
};

export function App() {
  const matcher = useMemo(() => createMatcherApi(), []);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [view, setView] = useState<ViewName>("dashboard");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return window.localStorage.getItem("survey-matcher-theme") === "dark" ? "dark" : "light";
  });
  const [queue, setQueue] = useState<QueueName>("unreviewed");
  const [response, setResponse] = useState<SurveyResponse | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RosterSearchResult[]>([]);
  const [schools, setSchools] = useState<RosterSchool[]>([]);
  const [showAddPupil, setShowAddPupil] = useState(false);
  const [addPupilForm, setAddPupilForm] = useState<AddPupilFormState>(emptyAddPupilForm);
  const [addPupilSaving, setAddPupilSaving] = useState(false);
  const [reviewedRecords, setReviewedRecords] = useState<ReviewedRecord[]>([]);
  const [reviewedLoading, setReviewedLoading] = useState(false);
  const [pupils, setPupils] = useState<PupilRecord[]>([]);
  const [responses, setResponses] = useState<ResponseRecord[]>([]);
  const [schoolSummaries, setSchoolSummaries] = useState<SchoolSummary[]>([]);
  const [qualityIssues, setQualityIssues] = useState<DataQualityIssue[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [importHistory, setImportHistory] = useState<ImportHistoryRecord[]>([]);
  const [workbenchLoading, setWorkbenchLoading] = useState(false);
  const [matchSearch, setMatchSearch] = useState("");
  const [matchStatus, setMatchStatus] = useState<MatchStatusFilter>("matched");
  const [matchSortKey, setMatchSortKey] = useState<MatchSortKey>("decided_at");
  const [matchSortDirection, setMatchSortDirection] = useState<SortDirection>("desc");
  const [importingSource, setImportingSource] = useState(false);
  const [importResult, setImportResult] = useState<ImportProcessedSourceResult | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const [exportingMatched, setExportingMatched] = useState(false);
  const [exportingCoverage, setExportingCoverage] = useState(false);
  const [exportResult, setExportResult] = useState<ExportCsvResult | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const loadNextRequestRef = useRef(0);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("survey-matcher-theme", theme);
  }, [theme]);

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.roster_child_id === selectedChildId),
    [candidates, selectedChildId]
  );

  const selectedSearchResult = useMemo(
    () => searchResults.find((item) => item.roster_child_id === selectedChildId),
    [searchResults, selectedChildId]
  );

  const refreshStats = useCallback(async () => {
    setStats(await matcher.getStats());
  }, [matcher]);

  const loadSchools = useCallback(async () => {
    setSchools(await matcher.getSchools());
  }, [matcher]);

  const loadReviewedRecords = useCallback(async () => {
    setReviewedLoading(true);
    try {
      setReviewedRecords(await matcher.getReviewedRecords());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load reviewed records.");
    } finally {
      setReviewedLoading(false);
    }
  }, [matcher]);

  const loadWorkbenchData = useCallback(async (targetView: ViewName) => {
    setWorkbenchLoading(true);
    try {
      if (targetView === "pupils") {
        const [nextPupils, nextSchools] = await Promise.all([matcher.getPupils(), matcher.getSchools()]);
        setPupils(nextPupils);
        setSchools(nextSchools);
      } else if (targetView === "responses") {
        const [nextResponses, nextSchools] = await Promise.all([matcher.getResponses(), matcher.getSchools()]);
        setResponses(nextResponses);
        setSchools(nextSchools);
      } else if (targetView === "schools") {
        setSchoolSummaries(await matcher.getSchoolSummaries());
      } else if (targetView === "quality") {
        const [nextIssues, nextSchools] = await Promise.all([matcher.getDataQualityIssues(), matcher.getSchools()]);
        setQualityIssues(nextIssues);
        setSchools(nextSchools);
      } else if (targetView === "audit") {
        const [nextEvents, nextImports] = await Promise.all([matcher.getAuditEvents(), matcher.getImportHistory()]);
        setAuditEvents(nextEvents);
        setImportHistory(nextImports);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load workbench data.");
    } finally {
      setWorkbenchLoading(false);
    }
  }, [matcher]);

  const loadNext = useCallback(
    async (targetQueue = queue) => {
      const requestId = loadNextRequestRef.current + 1;
      loadNextRequestRef.current = requestId;
      setLoading(true);
      setMessage("");
      const next = await matcher.getNextResponse(targetQueue);
      if (requestId !== loadNextRequestRef.current) return;
      setResponse(next);
      if (next) {
        const nextCandidates = await matcher.getCandidates(next.response_id);
        if (requestId !== loadNextRequestRef.current) return;
        setCandidates(nextCandidates);
        const preselected = nextCandidates.find((candidate) => candidate.preselected === "true");
        setSelectedChildId(preselected?.roster_child_id ?? nextCandidates[0]?.roster_child_id ?? "");
      } else {
        setCandidates([]);
        setSelectedChildId("");
      }
      setSearchQuery("");
      setSearchResults([]);
      await refreshStats();
      if (requestId !== loadNextRequestRef.current) return;
      setLoading(false);
    },
    [matcher, queue, refreshStats]
  );

  const loadInitialData = useCallback(async () => {
    await matcher.init();
    await loadSchools();
    await loadNext("unreviewed");
  }, [loadNext, loadSchools, matcher]);

  useEffect(() => {
    matcher
      .getCurrentUser()
      .then(async ({ user }) => {
        setAuthUser(user);
        if (user) {
          await loadInitialData();
        } else {
          setLoading(false);
        }
      })
      .catch((error: Error) => {
        setMessage(error.message);
        setLoading(false);
      })
      .finally(() => {
        setAuthChecked(true);
      });
  }, [loadInitialData, matcher]);

  const login = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setLoginLoading(true);
      setMessage("");
      try {
        const result = await matcher.login({ username: loginUsername, password: loginPassword });
        setAuthUser(result.user);
        setLoginPassword("");
        await loadInitialData();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not sign in.");
      } finally {
        setLoginLoading(false);
      }
    },
    [loadInitialData, loginPassword, loginUsername, matcher]
  );

  const logout = useCallback(async () => {
    await matcher.logout();
    setAuthUser(null);
    setResponse(null);
    setCandidates([]);
    setSelectedChildId("");
    setReviewedRecords([]);
    setPupils([]);
    setResponses([]);
    setSchoolSummaries([]);
    setQualityIssues([]);
    setAuditEvents([]);
    setImportHistory([]);
    setMessage("");
  }, [matcher]);

  const recordDecision = useCallback(
    async (action: DecisionAction) => {
      if (!response) return;
      if (action === "matched" && !selectedChildId) {
        setMessage("Select a roster pupil before accepting a match.");
        return;
      }
      try {
        await matcher.recordDecision({
          responseId: response.response_id,
          rosterChildId: action === "matched" || action === "duplicate" ? selectedChildId || undefined : undefined,
          action,
          revisesDecisionId: response.active_decision_id ?? undefined
        });
        await loadNext(queue);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not record decision.");
      }
    },
    [loadNext, matcher, queue, response, selectedChildId]
  );

  const undoLast = useCallback(async () => {
    const result = await matcher.undoLast();
    setMessage(result.ok ? "Last decision undone." : result.message ?? "Nothing to undo.");
    await loadNext(queue);
  }, [loadNext, matcher, queue]);

  const undoDecision = useCallback(
    async (decisionId: number) => {
      const result = await matcher.undoDecision(decisionId);
      setMessage(result.ok ? "Decision reopened." : result.message ?? "Could not reopen decision.");
      await refreshStats();
      await loadReviewedRecords();
      if (view === "review") await loadNext(queue);
    },
    [loadNext, loadReviewedRecords, matcher, queue, refreshStats, view]
  );

  const openAddPupil = useCallback(() => {
    const schoolRaw = selectedCandidate?.roster_school ?? selectedSearchResult?.school_raw ?? "";
    setAddPupilForm({ ...emptyAddPupilForm, schoolRaw });
    setShowAddPupil(true);
    setMessage("");
  }, [selectedCandidate, selectedSearchResult]);

  const submitAddPupil = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setAddPupilSaving(true);
      setMessage("");
      try {
        const added = await matcher.addRosterStudent(addPupilForm);
        setSearchResults([added]);
        setSearchQuery(`${added.forename_raw} ${added.surname_raw}`);
        setSelectedChildId(added.roster_child_id);
        setShowAddPupil(false);
        setAddPupilForm(emptyAddPupilForm);
        setMessage(`Added ${added.forename_raw} ${added.surname_raw} to the roster.`);
        await refreshStats();
        await loadSchools();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not add pupil.");
      } finally {
        setAddPupilSaving(false);
      }
    },
    [addPupilForm, loadSchools, matcher, refreshStats]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (view !== "review") return;
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (isTyping && event.key !== "Escape") return;

      if (event.key === "Enter") {
        event.preventDefault();
        void recordDecision("matched");
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const index = candidates.findIndex((candidate) => candidate.roster_child_id === selectedChildId);
        const next = candidates[Math.min(candidates.length - 1, index + 1)];
        if (next) setSelectedChildId(next.roster_child_id);
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const index = candidates.findIndex((candidate) => candidate.roster_child_id === selectedChildId);
        const next = candidates[Math.max(0, index - 1)];
        if (next) setSelectedChildId(next.roster_child_id);
      }
      if (event.key.toLowerCase() === "d") void recordDecision("deferred");
      if (event.key.toLowerCase() === "n") void recordDecision("no_match");
      if (event.key.toLowerCase() === "a") void recordDecision("ambiguous");
      if (event.key.toLowerCase() === "r") void recordDecision("duplicate");
      if (event.key.toLowerCase() === "u") void undoLast();
      if (event.key === "/") {
        event.preventDefault();
        document.getElementById("roster-search")?.focus();
      }
      if (event.key === "Escape") {
        setSearchQuery("");
        setSearchResults([]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [candidates, recordDecision, selectedChildId, undoLast, view]);

  useEffect(() => {
    let cancelled = false;
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const timeout = window.setTimeout(() => {
      matcher.searchRoster(searchQuery).then((results) => {
        if (!cancelled) setSearchResults(results);
      });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [matcher, searchQuery]);

  useEffect(() => {
    if (view === "matches") {
      void loadReviewedRecords();
    }
  }, [loadReviewedRecords, view]);

  useEffect(() => {
    if (!authUser || view !== "review") return;
    void loadNext(queue);
  }, [authUser, loadNext, queue, view]);

  const switchQueue = (nextQueue: QueueName) => {
    loadNextRequestRef.current += 1;
    setView("review");
    setQueue(nextQueue);
    setLoading(true);
    setResponse(null);
    setCandidates([]);
    setSelectedChildId("");
    setSearchQuery("");
    setSearchResults([]);
    setMessage("");
    if (view === "review" && nextQueue === queue) {
      void loadNext(nextQueue);
    }
  };

  const switchView = async (nextView: ViewName) => {
    setView(nextView);
    setMessage("");
    if (nextView === "matches") {
      await refreshStats();
      await loadReviewedRecords();
    } else if (["pupils", "responses", "schools", "quality", "audit"].includes(nextView)) {
      await loadWorkbenchData(nextView);
    }
  };

  const importProcessedSource = useCallback(async () => {
    setImportingSource(true);
    setMessage("");
    try {
      const result = await matcher.importProcessedSourceFolder();
      setImportResult(result);
      if (result.ok) {
        setStats(result.stats);
        await loadSchools();
        await loadReviewedRecords();
        await loadNext(queue);
        setMessage(`Imported ${result.surveyRows} deduped responses and ${result.candidateRows} candidate rows.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import processed source files.");
    } finally {
      setImportingSource(false);
    }
  }, [loadNext, loadReviewedRecords, loadSchools, matcher, queue]);

  const importRawQualtricsFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setImportingSource(true);
      setMessage("");
      try {
        const result = await matcher.importRawQualtricsFile(file);
        setImportResult(result);
        if (result.ok) {
          setStats(result.stats);
          await loadSchools();
          await loadReviewedRecords();
          await loadNext(queue);
          setMessage(`Imported ${result.surveyRows} new responses and ${result.candidateRows} candidate rows.`);
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not import raw Qualtrics file.");
      } finally {
        setImportingSource(false);
      }
    },
    [loadNext, loadReviewedRecords, loadSchools, matcher, queue]
  );

  const exportMatchedSurveyResponses = useCallback(async () => {
    setExportingMatched(true);
    setMessage("");
    try {
      const result = await matcher.exportMatchedSurveyResponses();
      setExportResult(result);
      if (result.ok) {
        setMessage(`Exported ${result.rows} matched rows.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not export matched survey data.");
    } finally {
      setExportingMatched(false);
    }
  }, [matcher]);

  const exportRosterCoverage = useCallback(async () => {
    setExportingCoverage(true);
    setMessage("");
    try {
      const result = await matcher.exportRosterCoverage();
      setExportResult(result);
      if (result.ok) {
        setMessage(`Exported ${result.rows} roster coverage rows.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not export roster coverage.");
    } finally {
      setExportingCoverage(false);
    }
  }, [matcher]);

  const setMatchSort = (sortKey: MatchSortKey) => {
    if (matchSortKey === sortKey) {
      setMatchSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setMatchSortKey(sortKey);
    setMatchSortDirection(sortKey === "decided_at" || sortKey === "score" || sortKey === "progress" ? "desc" : "asc");
  };

  const filteredReviewedRecords = useMemo(() => {
    const query = matchSearch.trim().toLowerCase();
    const filtered = reviewedRecords.filter((record) => {
      if (matchStatus !== "all" && record.action !== matchStatus) return false;
      if (!query) return true;
      const searchable = [
        record.response_id,
        actionLabel(record.action),
        reviewedPupilName(record),
        record.roster_school,
        record.roster_dob_iso,
        record.birth_month_year,
        record.entered_forename_raw,
        record.entered_school_raw,
        record.recorded_date_raw,
        record.decided_at,
        record.top_confidence,
        record.accepted_confidence
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchable.includes(query);
    });

    return [...filtered].sort((left, right) => {
      const leftValue = reviewedSortValue(left, matchSortKey);
      const rightValue = reviewedSortValue(right, matchSortKey);
      const direction = matchSortDirection === "asc" ? 1 : -1;
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * direction;
      }
      return String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" }) * direction;
    });
  }, [matchSearch, matchSortDirection, matchSortKey, matchStatus, reviewedRecords]);

  const headerTitle =
    view === "dashboard"
      ? "Dashboard"
      : view === "review"
        ? queueLabel(queue)
        : view === "matches"
          ? "Matched data"
          : view === "export"
            ? "Exports"
            : view === "import"
              ? "Import source"
              : view === "pupils"
                ? "Pupils"
                : view === "responses"
                  ? "Responses"
                  : view === "schools"
                    ? "Schools"
                    : view === "quality"
                      ? "Data quality"
                      : view === "help"
                        ? "Help"
                        : "Audit";
  const headerMeta =
    view === "review"
      ? loading
        ? "Loading"
        : response
          ? response.response_id
          : "Queue empty"
      : view === "matches"
        ? `${filteredReviewedRecords.length} visible · ${reviewedRecords.length} active decisions`
        : view === "export"
          ? "CSV outputs"
          : "Processed Qualtrics outputs";
  const resolvedHeaderMeta =
    view === "dashboard"
      ? `${stats.matched} matched from ${stats.reviewable} reviewable`
      : view === "review"
        ? loading
          ? "Loading"
          : response
            ? response.response_id
            : "Queue empty"
        : view === "matches"
          ? `${filteredReviewedRecords.length} visible · ${reviewedRecords.length} active decisions`
          : view === "export"
            ? "Live CSV outputs"
          : view === "import"
            ? "Raw Qualtrics uploads"
            : view === "help"
              ? "App guide"
              : "Workbench view";

  if (!authChecked) {
    return <FullScreenStatus label="Checking session" />;
  }

  if (!authUser) {
    return (
      <TooltipProvider>
        <LoginView
          username={loginUsername}
          password={loginPassword}
          loading={loginLoading}
          message={message}
          onUsernameChange={setLoginUsername}
          onPasswordChange={setLoginPassword}
          onSubmit={login}
        />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
    <SidebarProvider className="h-screen min-h-0 overflow-hidden bg-background text-foreground">
      <Sidebar collapsible="icon" className="border-sidebar-border">
        <SidebarHeader className="border-b border-sidebar-border p-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent">
              <ClipboardList size={16} />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <div className="truncate text-[14px] font-semibold">Survey Roster Matcher</div>
              <div className="mt-0.5 truncate text-[12px] text-muted">{stats.rosterChildren} pupils / {stats.reviewable} reviewable</div>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <ViewButton icon={<LayoutDashboard size={16} />} label="Dashboard" active={view === "dashboard"} onClick={() => switchView("dashboard")} />
                <ViewButton icon={<ClipboardList size={16} />} label="Match queue" value={stats.unreviewed} active={view === "review"} onClick={() => switchView("review")} />
                <ViewButton icon={<Users size={16} />} label="Pupils" active={view === "pupils"} onClick={() => switchView("pupils")} />
                <ViewButton icon={<Database size={16} />} label="Responses" active={view === "responses"} onClick={() => switchView("responses")} />
                <ViewButton icon={<Table2 size={16} />} label="Matches" value={stats.matched} active={view === "matches"} onClick={() => switchView("matches")} />
                <ViewButton icon={<School size={16} />} label="Schools" active={view === "schools"} onClick={() => switchView("schools")} />
                <ViewButton icon={<ShieldCheck size={16} />} label="Data quality" active={view === "quality"} onClick={() => switchView("quality")} />
                <ViewButton icon={<Download size={16} />} label="Exports" active={view === "export"} onClick={() => switchView("export")} />
                <ViewButton icon={<FileUp size={16} />} label="Imports" active={view === "import"} onClick={() => switchView("import")} />
                <ViewButton icon={<Database size={16} />} label="Audit" active={view === "audit"} onClick={() => switchView("audit")} />
                <ViewButton icon={<HelpCircle size={16} />} label="Help" active={view === "help"} onClick={() => switchView("help")} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

        </SidebarContent>
        {view === "review" ? (
          <SidebarFooter className="border-t border-sidebar-border p-4 group-data-[collapsible=icon]:hidden">
            <div className="text-[12px] text-muted">
              <div className="mb-2 font-medium text-foreground">Shortcuts</div>
              <Shortcut label="Accept" keys="Enter" />
              <Shortcut label="Move" keys="Up / Down" />
              <Shortcut label="Search" keys="/" />
              <Shortcut label="Defer" keys="D" />
              <Shortcut label="No match" keys="N" />
              <Shortcut label="Ambiguous" keys="A" />
              <Shortcut label="Duplicate" keys="R" />
              <Shortcut label="Undo" keys="U" />
            </div>
          </SidebarFooter>
        ) : null}
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="h-screen min-h-0 min-w-0 overflow-hidden">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-5 py-2">
          <div className="flex items-center gap-3 text-[13px] text-muted">
            <SidebarTrigger className="-ml-2" />
            <span className="font-medium text-foreground">{headerTitle}</span>
            <span>{resolvedHeaderMeta}</span>
            <span className="hidden">
              {view === "review"
                ? loading
                  ? "Loading"
                  : response
                    ? response.response_id
                    : "Queue empty"
                : view === "matches"
                  ? `${filteredReviewedRecords.length} visible · ${reviewedRecords.length} active decisions`
                  : "Processed Qualtrics outputs"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle dark mode">
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
            <Button variant="outline" onClick={() => switchView("help")}>
              <HelpCircle size={16} /> Help
            </Button>
            <Button variant="outline" onClick={logout}>
              {authUser.displayName} - Sign out
            </Button>
            {view === "review" ? (
              <>
                <Button variant="outline" onClick={undoLast}>
                  <Undo2 size={16} /> Undo
                </Button>
                <Button variant="outline" onClick={() => loadNext(queue)}>
                  <ListRestart size={16} /> Refresh
                </Button>
              </>
            ) : view === "matches" ? (
              <Button variant="outline" onClick={loadReviewedRecords}>
                <RefreshCw size={16} /> Refresh
              </Button>
            ) : null}
          </div>
        </div>

        {message ? (
          <div className="border-b border-destructive/20 bg-destructive/10 px-5 py-2 text-[13px] text-destructive">{message}</div>
        ) : null}

        {view === "dashboard" ? (
          <DashboardView stats={stats} schools={schools} onOpenReview={() => switchView("review")} onOpenMatches={() => switchView("matches")} onOpenImports={() => switchView("import")} />
        ) : view === "review" ? (
          <ReviewView
            queue={queue}
            stats={stats}
            loading={loading}
            response={response}
            candidates={candidates}
            selectedChildId={selectedChildId}
            searchQuery={searchQuery}
            searchResults={searchResults}
            schools={schools}
            showAddPupil={showAddPupil}
            addPupilForm={addPupilForm}
            addPupilSaving={addPupilSaving}
            onQueueChange={switchQueue}
            onSelectChild={setSelectedChildId}
            onSearchQueryChange={setSearchQuery}
            onOpenAddPupil={openAddPupil}
            onAddPupilFormChange={(patch) => setAddPupilForm((current) => ({ ...current, ...patch }))}
            onCancelAddPupil={() => {
              setShowAddPupil(false);
              setAddPupilForm(emptyAddPupilForm);
            }}
            onSubmitAddPupil={submitAddPupil}
            onRecordDecision={recordDecision}
          />
        ) : view === "matches" ? (
          <MatchesView
            records={filteredReviewedRecords}
            totalRecords={reviewedRecords.length}
            loading={reviewedLoading}
            search={matchSearch}
            status={matchStatus}
            sortKey={matchSortKey}
            sortDirection={matchSortDirection}
            stats={stats}
            onSearchChange={setMatchSearch}
            onStatusChange={setMatchStatus}
            onSortChange={setMatchSort}
            onUndoDecision={undoDecision}
          />
        ) : view === "pupils" ? (
          workbenchLoading ? <WorkbenchLoading label="Loading pupils" /> : <PupilsView pupils={pupils} schools={schools} />
        ) : view === "responses" ? (
          workbenchLoading ? <WorkbenchLoading label="Loading responses" /> : <ResponsesView responses={responses} schools={schools} />
        ) : view === "schools" ? (
          workbenchLoading ? <WorkbenchLoading label="Loading schools" /> : <SchoolsView schools={schoolSummaries} />
        ) : view === "quality" ? (
          workbenchLoading ? <WorkbenchLoading label="Loading data quality" /> : <DataQualityView issues={qualityIssues} schools={schools} />
        ) : view === "audit" ? (
          workbenchLoading ? <WorkbenchLoading label="Loading audit log" /> : <AuditView events={auditEvents} imports={importHistory} />
        ) : view === "help" ? (
          <HelpView />
        ) : view === "export" ? (
          <ExportView
            stats={stats}
            exportingMatched={exportingMatched}
            exportingCoverage={exportingCoverage}
            result={exportResult}
            onExportMatched={exportMatchedSurveyResponses}
            onExportCoverage={exportRosterCoverage}
          />
        ) : view === "import" ? (
          <ImportSourceView
            importing={importingSource}
            result={importResult}
            fileInputRef={importFileInputRef}
            onFileSelected={importRawQualtricsFile}
            onImport={() => importFileInputRef.current?.click()}
          />
        ) : null}
      </SidebarInset>
    </SidebarProvider>
    </TooltipProvider>
  );
}

function WorkbenchLoading({ label }: { label: string }) {
  return (
    <section className="min-h-0 flex-1 overflow-auto p-5">
      <Card className="max-w-[760px]">
        <CardHeader>
          <CardTitle>{label}</CardTitle>
        </CardHeader>
        <CardContent className="text-[13px] text-muted">
          Fetching current workbench records.
        </CardContent>
      </Card>
    </section>
  );
}

function FullScreenStatus({ label }: { label: string }) {
  return (
    <div className="flex h-screen items-center justify-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-[360px]">
        <CardHeader>
          <CardTitle>{label}</CardTitle>
        </CardHeader>
        <CardContent className="text-[13px] text-muted">Loading the matcher workspace.</CardContent>
      </Card>
    </div>
  );
}

function LoginView({
  username,
  password,
  loading,
  message,
  onUsernameChange,
  onPasswordChange,
  onSubmit
}: {
  username: string;
  password: string;
  loading: boolean;
  message: string;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="flex h-screen items-center justify-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-[380px]">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={onSubmit}>
            <label className="block text-[13px] font-medium">
              Username
              <Input className="mt-1" value={username} onChange={(event) => onUsernameChange(event.target.value)} autoComplete="username" />
            </label>
            <label className="block text-[13px] font-medium">
              Password
              <Input className="mt-1" type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} autoComplete="current-password" />
            </label>
            {message ? <div className="text-[13px] text-destructive">{message}</div> : null}
            <Button className="w-full" type="submit" disabled={loading || !username.trim() || !password}>
              {loading ? "Signing in" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function ViewButton({ icon, label, value, active, onClick }: { icon: JSX.Element; label: string; value?: number; active: boolean; onClick: () => void }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={label}
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={cls(
          "h-9 border px-2.5 transition-colors",
          active
            ? "border-sidebar-foreground/15 bg-sidebar-accent text-sidebar-accent-foreground"
            : "border-transparent text-sidebar-foreground/80 hover:border-sidebar-border hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground active:bg-sidebar-accent"
        )}
      >
        {icon}
        <span>{label}</span>
      </SidebarMenuButton>
      {typeof value === "number" ? (
        <SidebarMenuBadge className={active ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/60"}>
          {value}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}

function Shortcut({ label, keys }: { label: string; keys: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span>{label}</span>
      <span className="font-mono text-[11px] text-ink">{keys}</span>
    </div>
  );
}

