import { AlertCircle, Check, ChevronDown, Clock3, CopyCheck, CornerDownLeft, Search, UserPlus, X } from "lucide-react";
import type { FormEvent } from "react";
import type {
  Candidate,
  DecisionAction,
  QueueName,
  RosterSchool,
  RosterSearchResult,
  Stats,
  SurveyResponse
} from "@/types";
import type { AddPupilFormState } from "@/app/types";
import { cls, prettyConfidence, queueLabel, splitReasons } from "@/app/matchUtils";
import { Button } from "@/components/ui/button";

export function ReviewView({
  queue,
  stats,
  loading,
  response,
  candidates,
  selectedChildId,
  searchQuery,
  searchResults,
  schools,
  showAddPupil,
  addPupilForm,
  addPupilSaving,
  onQueueChange,
  onSelectChild,
  onSearchQueryChange,
  onOpenAddPupil,
  onAddPupilFormChange,
  onCancelAddPupil,
  onSubmitAddPupil,
  onRecordDecision
}: {
  queue: QueueName;
  stats: Stats;
  loading: boolean;
  response: SurveyResponse | null;
  candidates: Candidate[];
  selectedChildId: string;
  searchQuery: string;
  searchResults: RosterSearchResult[];
  schools: RosterSchool[];
  showAddPupil: boolean;
  addPupilForm: AddPupilFormState;
  addPupilSaving: boolean;
  onQueueChange: (nextQueue: QueueName) => void | Promise<void>;
  onSelectChild: (childId: string) => void;
  onSearchQueryChange: (value: string) => void;
  onOpenAddPupil: () => void;
  onAddPupilFormChange: (patch: Partial<AddPupilFormState>) => void;
  onCancelAddPupil: () => void;
  onSubmitAddPupil: (event: FormEvent<HTMLFormElement>) => void;
  onRecordDecision: (action: DecisionAction) => void;
}) {
  const selectedCandidate = candidates.find((candidate) => candidate.roster_child_id === selectedChildId);
  const selectedSearchResult = searchResults.find((item) => item.roster_child_id === selectedChildId);

  return (
    <div className="grid min-h-0 flex-1 overflow-auto lg:overflow-hidden lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0 overflow-auto p-4">
        <ReviewQueueSwitcher queue={queue} stats={stats} onQueueChange={onQueueChange} />
        {loading ? (
          <LoadingQueue queue={queue} />
        ) : !response ? (
          <EmptyQueue queue={queue} onDeferred={() => onQueueChange("deferred")} />
        ) : (
          <>
            <ResponseCard response={response} />
            <div className="mt-4 flex items-center justify-between">
              <div className="text-[14px] font-semibold">Candidates</div>
              <div className="text-[12px] text-muted">{candidates.length} generated</div>
            </div>
            <div className="mt-2 space-y-2">
              {candidates.length ? (
                candidates.map((candidate) => (
                  <CandidateRow
                    key={`${candidate.response_id}-${candidate.candidate_rank}`}
                    candidate={candidate}
                    selected={candidate.roster_child_id === selectedChildId}
                    onSelect={() => onSelectChild(candidate.roster_child_id)}
                  />
                ))
              ) : (
                <div className="rounded-md border border-line bg-panel p-5 text-[14px] text-muted">
                  No generated candidates. Use roster search or mark this response as deferred/no match.
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <aside className="min-h-0 min-w-0 overflow-auto border-t border-line bg-mutedSurface p-4 lg:border-l lg:border-t-0">
        <div className="rounded-md border border-line bg-panel">
          <div className="border-b border-line p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <label className="block text-[13px] font-medium" htmlFor="roster-search">Roster search</label>
              <button
                className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-background px-2 text-[12px] hover:bg-accent active:bg-accent/80"
                onClick={onOpenAddPupil}
              >
                <UserPlus size={14} /> Add pupil
              </button>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-line bg-background px-2">
              <Search size={16} className="text-muted" />
              <input
                id="roster-search"
                className="h-9 w-full bg-transparent text-[14px] outline-none"
                value={searchQuery}
                onChange={(event) => onSearchQueryChange(event.target.value)}
                placeholder="Name, school, or DOB"
              />
            </div>
          </div>
          <div className="max-h-[360px] overflow-auto p-2">
            {searchResults.length ? (
              searchResults.map((result) => (
                <button
                  key={result.roster_child_id}
                  className={cls(
                    "focus-ring block w-full rounded-md px-3 py-2 text-left text-[13px] hover:bg-accent",
                    selectedChildId === result.roster_child_id && "bg-primary/10"
                  )}
                  onClick={() => onSelectChild(result.roster_child_id)}
                >
                  <div className="font-medium">{result.forename_raw} {result.surname_raw}</div>
                  <div className="mt-0.5 text-[12px] text-muted">{result.school_raw} - {result.dob_iso || "DOB missing"}</div>
                  {result.matched_response_id ? <div className="mt-1 text-[12px] text-warn">Already matched to {result.matched_response_id}</div> : null}
                </button>
              ))
            ) : (
              <div className="px-3 py-8 text-center text-[13px] text-muted">Type at least two characters.</div>
            )}
          </div>
        </div>

        {showAddPupil ? (
          <AddPupilForm
            form={addPupilForm}
            schools={schools}
            saving={addPupilSaving}
            onChange={onAddPupilFormChange}
            onCancel={onCancelAddPupil}
            onSubmit={onSubmitAddPupil}
          />
        ) : null}

        <div className="mt-4 rounded-md border border-line bg-panel p-3">
          <div className="mb-3 text-[13px] font-medium">Selected pupil</div>
          {selectedCandidate ? (
            <SelectedCandidate candidate={selectedCandidate} />
          ) : selectedSearchResult ? (
            <SelectedSearchResult result={selectedSearchResult} />
          ) : (
            <div className="text-[13px] text-muted">No pupil selected.</div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button className="col-span-2 h-10" onClick={() => onRecordDecision("matched")}>
            <CornerDownLeft size={17} /> Accept match
          </Button>
          <Button variant="outline" className="h-9" onClick={() => onRecordDecision("deferred")}>
            <Clock3 size={15} /> Defer
          </Button>
          <Button variant="outline" className="h-9" onClick={() => onRecordDecision("ambiguous")}>
            <AlertCircle size={15} /> Ambiguous
          </Button>
          <Button variant="outline" className="h-9" onClick={() => onRecordDecision("duplicate")}>
            <CopyCheck size={15} /> Duplicate response
          </Button>
          <Button variant="destructive" className="col-span-2 h-9" onClick={() => onRecordDecision("no_match")}>
            <X size={15} /> No roster match
          </Button>
        </div>
      </aside>
    </div>
  );
}

function ReviewQueueSwitcher({
  queue,
  stats,
  onQueueChange
}: {
  queue: QueueName;
  stats: Stats;
  onQueueChange: (nextQueue: QueueName) => void | Promise<void>;
}) {
  const queues: Array<{ key: QueueName; label: string; value: number }> = [
    { key: "unreviewed", label: "Unreviewed", value: stats.unreviewed },
    { key: "deferred", label: "Deferred", value: stats.deferred },
    { key: "ambiguous", label: "Ambiguous", value: stats.ambiguous },
    { key: "duplicate", label: "Duplicate", value: stats.duplicate }
  ];

  return (
    <div className="mb-4 rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="text-[13px] font-medium">Review queues</div>
        <div className="text-[12px] text-muted">{stats.reviewable} reviewable responses</div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2 p-2">
        {queues.map((item) => (
          <Button
            key={item.key}
            variant={queue === item.key ? "default" : "outline"}
            className="h-10 min-w-0 shrink justify-between gap-2 overflow-hidden px-3"
            aria-pressed={queue === item.key}
            onClick={() => onQueueChange(item.key)}
          >
            <span className="min-w-0 truncate">{item.label}</span>
            <span className={`shrink-0 ${queue === item.key ? "text-primary-foreground/75" : "text-muted"}`}>{item.value}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

function AddPupilForm({
  form,
  schools,
  saving,
  onChange,
  onCancel,
  onSubmit
}: {
  form: AddPupilFormState;
  schools: RosterSchool[];
  saving: boolean;
  onChange: (patch: Partial<AddPupilFormState>) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="mt-4 min-w-0 rounded-md border border-line bg-panel p-3 text-[13px]" onSubmit={onSubmit}>
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
        <div className="font-medium">Add roster pupil</div>
        <button type="button" className="focus-ring rounded-md p-1 text-muted hover:bg-[#f0eee8] hover:text-ink" onClick={onCancel}>
          <X size={15} />
        </button>
      </div>
      <div className="grid gap-2">
        <label className="grid min-w-0 gap-1">
          <span className="text-[12px] text-muted">School</span>
          <input
            className="h-9 min-w-0 rounded-md border border-line bg-background px-2"
            list="school-options"
            value={form.schoolRaw}
            onChange={(event) => onChange({ schoolRaw: event.target.value })}
            required
          />
        </label>
        <datalist id="school-options">
          {schools.map((school) => (
            <option key={school.school_raw} value={school.school_raw} />
          ))}
        </datalist>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.75rem,1fr))] gap-2">
          <label className="grid min-w-0 gap-1">
            <span className="text-[12px] text-muted">Forename</span>
            <input
              className="h-9 min-w-0 rounded-md border border-line bg-background px-2"
              value={form.forenameRaw}
              onChange={(event) => onChange({ forenameRaw: event.target.value })}
              required
            />
          </label>
          <label className="grid min-w-0 gap-1">
            <span className="text-[12px] text-muted">Surname</span>
            <input
              className="h-9 min-w-0 rounded-md border border-line bg-background px-2"
              value={form.surnameRaw}
              onChange={(event) => onChange({ surnameRaw: event.target.value })}
              required
            />
          </label>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.75rem,1fr))] gap-2">
          <label className="grid min-w-0 gap-1">
            <span className="text-[12px] text-muted">DOB</span>
            <input
              className="h-9 min-w-0 rounded-md border border-line bg-background px-2"
              type="date"
              value={form.dobIso}
              onChange={(event) => onChange({ dobIso: event.target.value })}
            />
          </label>
          <label className="grid min-w-0 gap-1">
            <span className="text-[12px] text-muted">Sex</span>
            <input
              className="h-9 min-w-0 rounded-md border border-line bg-background px-2"
              value={form.sex}
              onChange={(event) => onChange({ sex: event.target.value })}
            />
          </label>
        </div>
        <label className="grid min-w-0 gap-1">
          <span className="text-[12px] text-muted">UPN</span>
          <input
            className="h-9 min-w-0 rounded-md border border-line bg-background px-2"
            value={form.upn}
            onChange={(event) => onChange({ upn: event.target.value })}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? "Adding" : "Add pupil"}</Button>
      </div>
    </form>
  );
}

function ResponseCard({ response }: { response: SurveyResponse }) {
  const dedupeLabel =
    response.dedupe_decision === "retain_canonical" || response.duplicate_response_classification === "canonical"
      ? "Retained canonical response"
      : response.dedupe_decision
        ? response.dedupe_decision.replaceAll("_", " ")
        : "";
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="grid grid-cols-2 gap-0 border-b border-line">
        <ResponseField label="Entered name" value={response.entered_forename_raw || "Blank"} />
        <ResponseField label="Entered school" value={response.entered_school_raw || "Blank"} />
        <ResponseField label="Birth month/year" value={response.birth_month_year || "Missing"} />
        <ResponseField label="Progress" value={`${response.progress}%`} />
      </div>
      <div className="flex items-center justify-between px-4 py-3 text-[13px]">
        <div className="flex items-center gap-3 text-muted">
          <span>{response.response_class.replaceAll("_", " ")}</span>
          <span>{response.recorded_date_raw}</span>
          {dedupeLabel ? (
            <span title="This is the retained response from a deduplicated response group. Discarded duplicate submissions are not meant to be reviewed.">
              {dedupeLabel}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-line px-2 py-1 text-[12px] text-muted">{response.top_confidence}</span>
          <span className="rounded-md border border-line px-2 py-1 text-[12px] text-muted">{response.candidate_count} candidates</span>
        </div>
      </div>
      {response.manual_identifier_decision ? (
        <div className="border-t border-line bg-[#fbfaf7] px-4 py-2 text-[12px] text-muted">{response.manual_identifier_decision}</div>
      ) : null}
    </div>
  );
}

function ResponseField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-r border-line px-4 py-3 last:border-r-0">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1 truncate text-[18px] font-semibold" title={value}>{value}</div>
    </div>
  );
}

function CandidateRow({ candidate, selected, onSelect }: { candidate: Candidate; selected: boolean; onSelect: () => void }) {
  const reasons = splitReasons(candidate.reason_codes);
  const alreadyMatched = Boolean(candidate.matched_response_id);
  return (
    <button
      className={cls(
        "focus-ring block w-full rounded-md border bg-panel p-3 text-left",
        selected ? "border-primary ring-1 ring-primary" : "border-line hover:border-foreground/25",
        alreadyMatched && "bg-warning/10"
      )}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-muted">#{candidate.candidate_rank}</span>
            <span className="truncate text-[15px] font-semibold">{candidate.roster_forename} {candidate.roster_surname}</span>
            {candidate.preselected === "true" ? <Check size={16} className="text-accent" /> : null}
          </div>
          <div className="mt-1 text-[13px] text-muted">{candidate.roster_school} - {candidate.roster_dob_iso || candidate.roster_birth_month_year || "DOB missing"}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[15px] font-semibold">{Number(candidate.score).toFixed(1)}</div>
          <div className="text-[12px] text-muted">{prettyConfidence(candidate.confidence)}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {reasons.slice(0, 8).map((reason) => (
          <span key={reason} className="rounded-md border border-line bg-mutedSurface px-2 py-1 text-[11px] text-muted">
            {reason.replaceAll("_", " ")}
          </span>
        ))}
      </div>
      {alreadyMatched ? (
        <div className="mt-2 text-[12px] text-warn">Already matched to {candidate.matched_response_id}</div>
      ) : null}
    </button>
  );
}

function SelectedCandidate({ candidate }: { candidate: Candidate }) {
  return (
    <div className="text-[13px]">
      <div className="font-semibold">{candidate.roster_forename} {candidate.roster_surname}</div>
      <div className="mt-1 text-muted">{candidate.roster_school}</div>
      <div className="mt-1 text-muted">{candidate.roster_dob_iso || candidate.roster_birth_month_year || "DOB missing"}</div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
        <MiniMetric label="Score" value={Number(candidate.score).toFixed(1)} />
        <MiniMetric label="School" value={Number(candidate.school_score).toFixed(2)} />
        <MiniMetric label="Name" value={Number(candidate.name_score).toFixed(2)} />
      </div>
    </div>
  );
}

function SelectedSearchResult({ result }: { result: RosterSearchResult }) {
  return (
    <div className="text-[13px]">
      <div className="font-semibold">{result.forename_raw} {result.surname_raw}</div>
      <div className="mt-1 text-muted">{result.school_raw}</div>
      <div className="mt-1 text-muted">{result.dob_iso || "DOB missing"}</div>
      {result.matched_response_id ? <div className="mt-2 text-warn">Already matched to {result.matched_response_id}</div> : null}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 font-semibold">{value}</div>
    </div>
  );
}

function EmptyQueue({ queue, onDeferred }: { queue: QueueName; onDeferred: () => void }) {
  return (
    <div className="rounded-md border border-line bg-panel p-8 text-[14px]">
      <div className="font-semibold">{queueLabel(queue)} is empty.</div>
      <div className="mt-2 max-w-[520px] text-muted">
        Continue with another queue or use the refresh button if candidate data was regenerated.
      </div>
      {queue === "unreviewed" ? (
        <button className="focus-ring mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 hover:bg-[#f0eee8]" onClick={onDeferred}>
          <ChevronDown size={16} /> Open deferred
        </button>
      ) : null}
    </div>
  );
}

function LoadingQueue({ queue }: { queue: QueueName }) {
  return (
    <div className="rounded-md border border-line bg-panel p-8 text-[14px]">
      <div className="font-semibold">Loading {queueLabel(queue).toLowerCase()}.</div>
      <div className="mt-2 max-w-[520px] text-muted">Fetching the next response and generated candidates.</div>
    </div>
  );
}
