import { FileUp } from "lucide-react";
import type { ChangeEvent, RefObject } from "react";
import type { ImportProcessedSourceResult } from "@/types";
import { Button } from "@/components/ui/button";

export function ImportSourceView({
  importing,
  result,
  fileInputRef,
  onFileSelected,
  onImport
}: {
  importing: boolean;
  result: ImportProcessedSourceResult | null;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onImport: () => void;
}) {
  return (
    <section className="min-h-0 flex-1 overflow-auto p-5">
      <div className="max-w-[860px] rounded-md border border-line bg-panel">
        <div className="border-b border-line p-4">
          <div className="text-[15px] font-semibold">Import Qualtrics source</div>
          <div className="mt-1 max-w-[720px] text-[13px] text-muted">
            Choose the raw Qualtrics ZIP or CSV export. The app will process it into matcher-ready files and preserve existing review decisions.
          </div>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_240px]">
          <div className="space-y-3 text-[13px]">
            <RequiredFileRow name="Qualtrics export" detail="Raw ZIP or CSV from Qualtrics. ZIP exports are preferred because they preserve the full response file." />
            <RequiredFileRow name="Roster file" detail="The current roster stays in the app data folder. Replacing the roster is still handled outside this import step." />
            <RequiredFileRow name="Review database" detail="Existing matches, deferred, ambiguous, no-match, and duplicate decisions are preserved. New duplicate submissions must be marked manually with Duplicate response." />
          </div>
          <div className="rounded-md border border-line bg-[#fbfaf7] p-3 text-[13px]">
            <div className="font-medium">Current run</div>
            <div className="mt-2 text-muted">
              Import creates backups before replacing active processed files.
            </div>
            <Button className="mt-4 w-full" disabled={importing} onClick={onImport}>
              <FileUp size={16} /> {importing ? "Importing" : "Choose Qualtrics export"}
            </Button>
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              accept=".zip,.csv,text/csv,application/zip"
              onChange={onFileSelected}
            />
          </div>
        </div>
        {result ? (
          <div className="border-t border-line px-4 py-3 text-[13px]">
            {result.ok ? (
              <div className="space-y-1">
                <div className="font-medium text-accent">Import complete</div>
                <div>{result.surveyRows} deduped responses</div>
                <div>{result.candidateRows} candidate rows</div>
                <div>{result.stats.reviewable} reviewable responses</div>
                <div>{result.stats.unreviewed} unreviewed</div>
                {result.backupDir ? <div className="text-muted">Backup: {result.backupDir}</div> : null}
              </div>
            ) : (
              <div className="text-muted">Import cancelled.</div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function RequiredFileRow({ name, detail }: { name: string; detail: string }) {
  return (
    <div className="rounded-md border border-line bg-background p-3">
      <div className="font-medium">{name}</div>
      <div className="mt-1 text-muted">{detail}</div>
    </div>
  );
}
