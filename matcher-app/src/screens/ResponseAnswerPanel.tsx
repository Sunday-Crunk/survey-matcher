import { useEffect, useState } from "react";
import type { ResponseDetailData } from "@/types";

type ResponseAnswerPanelProps = {
  responseId: string | null | undefined;
  onLoadResponseDetail: (responseId: string) => Promise<ResponseDetailData | null>;
};

export function ResponseAnswerPanel({ responseId, onLoadResponseDetail }: ResponseAnswerPanelProps) {
  const [detail, setDetail] = useState<ResponseDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError("");

    if (!responseId) {
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    onLoadResponseDetail(responseId)
      .then((nextDetail) => {
        if (!cancelled) setDetail(nextDetail);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load response answers.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [onLoadResponseDetail, responseId]);

  return (
    <section className="mt-4 min-h-0 rounded-md border border-line bg-background">
      <div className="border-b border-line px-3 py-2">
        <div className="text-[13px] font-semibold">Response data</div>
        <div className="mt-0.5 text-[12px] text-muted">{responseId || "No linked survey response"}</div>
      </div>
      {!responseId ? (
        <div className="px-3 py-4 text-[13px] text-muted">Select a row with a survey response to view answers.</div>
      ) : loading ? (
        <div className="px-3 py-4 text-[13px] text-muted">Loading response data.</div>
      ) : error ? (
        <div className="px-3 py-4 text-[13px] text-destructive">{error}</div>
      ) : detail?.fields.length ? (
        <div className="max-h-[420px] min-h-[180px] overflow-auto">
          {detail.fields.map((field) => (
            <div key={field.field} className="grid grid-cols-[minmax(120px,42%)_minmax(0,1fr)] gap-3 border-b border-line px-3 py-2 last:border-b-0">
              <div className="break-words text-[12px] text-muted">{field.field}</div>
              <div className="break-words text-[13px] font-medium">{field.value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-3 py-4 text-[13px] text-muted">No non-empty answer fields were stored for this response.</div>
      )}
    </section>
  );
}
