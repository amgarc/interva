import Link from "next/link";
import { listOutreachByStage, STAGES, STAGE_DISPLAY, STAGE_COLOR } from "@/lib/outreach";

export const dynamic = "force-dynamic";

export default async function OutreachKanbanPage() {
  const grouped = await listOutreachByStage();
  const total = Array.from(grouped.values()).reduce((s, rows) => s + rows.length, 0);

  return (
    <>
      <div className="flex items-end justify-between mb-6">
        <h1 className="text-2xl font-semibold">Outreach funnel</h1>
        <div className="text-sm opacity-70">{total.toLocaleString()} in funnel</div>
      </div>

      {total === 0 && (
        <div className="border border-dashed border-black/15 dark:border-white/15 rounded p-6 text-sm opacity-70">
          No physicians enrolled yet. Bulk-enroll the OBL/ASC active cohort with:
          <pre className="mt-2 text-xs bg-black/5 dark:bg-white/5 p-2 rounded">
{`npx tsx scripts/seed-outreach.ts oblasc-active`}
          </pre>
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {STAGES.map((stage) => {
          const rows = grouped.get(stage) ?? [];
          return (
            <div
              key={stage}
              className="min-w-[260px] max-w-[260px] flex-shrink-0"
            >
              <div className={`rounded-t p-2 text-sm font-medium ${STAGE_COLOR[stage]} flex items-center justify-between`}>
                <span>{STAGE_DISPLAY[stage]}</span>
                <span className="opacity-70">{rows.length}</span>
              </div>
              <div className="border border-t-0 border-black/10 dark:border-white/10 rounded-b min-h-[200px] p-2 space-y-2 bg-black/[0.02] dark:bg-white/[0.02]">
                {rows.slice(0, 50).map((r) => {
                  const name = `${r.physician.firstName ?? ""} ${r.physician.lastName ?? ""}`.trim() || r.physician.npi;
                  const where = r.physician.addresses[0];
                  return (
                    <Link
                      key={r.npi}
                      href={`/physicians/${r.npi}`}
                      className="block p-2 rounded bg-white dark:bg-black border border-black/10 dark:border-white/10 hover:border-black/30 dark:hover:border-white/30 text-xs"
                    >
                      <div className="font-medium truncate">{name}</div>
                      <div className="opacity-60 truncate">
                        {where?.city ?? "?"}, {where?.state ?? "?"}
                      </div>
                      {r.physician.persona && (
                        <div className="mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] bg-black/5 dark:bg-white/10">
                          {r.physician.persona.archetype}
                        </div>
                      )}
                      {r.lastTouchAt && (
                        <div className="opacity-50 mt-1 text-[10px]">
                          {r.lastTouchAt.toISOString().slice(0, 10)}
                        </div>
                      )}
                    </Link>
                  );
                })}
                {rows.length > 50 && (
                  <div className="text-xs opacity-50 text-center pt-1">+{rows.length - 50} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
