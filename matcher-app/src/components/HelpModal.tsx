import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[86vh] max-w-[760px] overflow-auto">
        <DialogHeader>
          <DialogTitle>Review guide</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 text-[13px] leading-5 text-muted">
          <HelpSection title="Review queues">
            <HelpItem term="Unreviewed" detail="Responses with no active decision. This is the main queue." />
            <HelpItem term="Deferred" detail="Use when the response needs more information or should be handled later." />
            <HelpItem term="Ambiguous" detail="Use when more than one roster pupil could plausibly be the same child." />
            <HelpItem term="Duplicate" detail="Responses manually marked as another submission from a pupil already represented elsewhere." />
          </HelpSection>

          <HelpSection title="Decision actions">
            <HelpItem term="Accept match" detail="Links the selected roster pupil to the current survey response." />
            <HelpItem term="No roster match" detail="Use when the response should remain unmatched after review." />
            <HelpItem term="Undo/Reopen" detail="Undo reverses the latest decision. Reopen in the Matches view reverses that specific row and returns the response to review." />
          </HelpSection>

          <HelpSection title="Candidate evidence">
            <HelpItem term="Score" detail="Generated match strength. Use it as evidence, not as the only decision rule." />
            <HelpItem term="Medium/Low" detail="Generated review candidates with weaker evidence. Check entered name, school, month/year, and any already-matched warning." />
            <HelpItem term="Already matched" detail="The roster pupil is linked to another response. Only choose Duplicate response if the current response is the duplicate submission." />
          </HelpSection>

          <HelpSection title="Roster search and additions">
            <HelpItem term="Roster search" detail="Search the full roster when generated candidates miss the correct pupil." />
            <HelpItem term="Manual additions" detail="Manual additions persist in matcher_review.sqlite and are replayed after each CSV import. Generated candidate lists are not recalculated for them yet, so use search to select them." />
          </HelpSection>

          <HelpSection title="Imports and persistence">
            <HelpItem term="Raw Qualtrics import" detail="Choose the ZIP or CSV export from Qualtrics. Existing active decisions are preserved against matching response IDs." />
            <HelpItem term="Persistence" detail="Decisions and manual roster additions live in the portable folder's outputs/matcher_review.sqlite file." />
            <HelpItem term="Backups" detail="Before replacing the active files, the app backs up the current processed CSVs and matcher_review.sqlite under outputs/import_backups." />
          </HelpSection>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HelpSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[14px] font-semibold text-foreground">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function HelpItem({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="grid gap-2 rounded-md border border-line bg-background p-3 sm:grid-cols-[150px_minmax(0,1fr)]">
      <div className="font-medium text-foreground">{term}</div>
      <div>{detail}</div>
    </div>
  );
}
