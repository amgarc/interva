// SourcedValue — wrap any displayed value to expose its provenance on hover.
// Renders a small dotted underline + ⓘ glyph; CSS-only tooltip on hover/focus
// shows source name, fetched date, source URL link, and confidence.
//
// Usage:
//   <SourcedValue
//     facts={[{ source, sourceUrl, fetchedAt, confidence }, ...]}
//   >
//     {p.firstName} {p.lastName}
//   </SourcedValue>
//
// `facts` can be empty (e.g. for NPI which is the row's PK) — in that case
// we render children unwrapped.

import type { ReactNode } from "react";

export interface FactProvenance {
  sourceKey: string;
  sourceDisplayName: string;
  fetchedAt: Date | string;
  sourceUrl?: string | null;
  confidence?: number | null;
}

interface SourcedValueProps {
  children: ReactNode;
  facts: FactProvenance[];
  inferenceNote?: string; // optional: extra context like "ZIP+city match"
}

export function SourcedValue({ children, facts, inferenceNote }: SourcedValueProps) {
  if (facts.length === 0) {
    return <>{children}</>;
  }

  return (
    <span className="sourced inline relative group">
      <span className="cursor-help underline decoration-dotted decoration-1 underline-offset-2 decoration-black/30 dark:decoration-white/30">
        {children}
      </span>
      <span
        aria-hidden
        className="ml-0.5 text-[10px] opacity-50 group-hover:opacity-100 align-super select-none"
      >
        ⓘ
      </span>
      <span
        role="tooltip"
        className="invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-opacity absolute left-0 top-full mt-1 z-50 min-w-[260px] max-w-[380px] p-2 rounded-md border border-black/10 dark:border-white/15 bg-white dark:bg-black shadow-lg text-xs text-left"
      >
        <div className="font-medium mb-1 opacity-80">Source{facts.length > 1 ? `s (${facts.length})` : ""}</div>
        <ul className="space-y-1.5">
          {facts.map((f, i) => {
            const fetched = typeof f.fetchedAt === "string" ? f.fetchedAt : f.fetchedAt.toISOString().slice(0, 10);
            const conf = f.confidence != null ? `  · ${(f.confidence * 100).toFixed(0)}%` : "";
            return (
              <li key={i} className="leading-tight">
                <div className="font-medium">{f.sourceDisplayName}</div>
                <div className="opacity-60">
                  {fetched}
                  {conf}
                </div>
                {f.sourceUrl && (
                  <a
                    href={f.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline break-all"
                  >
                    evidence ↗
                  </a>
                )}
              </li>
            );
          })}
        </ul>
        {inferenceNote && (
          <div className="mt-1.5 pt-1.5 border-t border-black/5 dark:border-white/10 opacity-70 text-[11px]">
            {inferenceNote}
          </div>
        )}
      </span>
    </span>
  );
}

// Helper: convert a list of Prisma Facts (with included Source) into provenance objects.
export function factsToProvenance(
  facts: Array<{
    sourceKey: string;
    source?: { displayName: string } | null;
    sourceUrl?: string | null;
    fetchedAt: Date;
    confidence?: number | null;
  }>,
): FactProvenance[] {
  return facts.map((f) => ({
    sourceKey: f.sourceKey,
    sourceDisplayName: f.source?.displayName ?? f.sourceKey,
    fetchedAt: f.fetchedAt,
    sourceUrl: f.sourceUrl,
    confidence: f.confidence ?? null,
  }));
}

// For canonical fields where we know the source by convention but don't store
// per-Fact rows (e.g., NPPES name fields), build a synthetic provenance.
export function syntheticProvenance(
  sourceKey: string,
  sourceDisplayName: string,
  fetchedAt: Date,
  confidence = 0.95,
): FactProvenance {
  return {
    sourceKey,
    sourceDisplayName,
    fetchedAt,
    confidence,
  };
}
