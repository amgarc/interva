import Link from "next/link";
import { FilterBar } from "@/components/filter-bar";
import { PhysicianTable } from "@/components/physician-table";
import { Pagination } from "@/components/pagination";
import { listPhysicians, listPracticeStates } from "@/lib/physicians";
import { buildExportHref, buildPageHref, parseFilters } from "@/lib/search-params";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const filters = parseFilters(raw);

  const [{ rows, total, page, perPage, pageCount }, states] = await Promise.all([
    listPhysicians({
      q: filters.q,
      state: filters.state,
      taxonomyCodes: filters.taxonomyCodes,
      primaryOnly: filters.primaryOnly,
      includeDeactivated: filters.includeDeactivated,
      activeIrOnly: filters.activeIrOnly,
      sortBy: filters.sortBy,
      page: filters.page,
    }),
    listPracticeStates(),
  ]);

  return (
    <>
      <div className="flex items-end justify-between mb-4">
        <h1 className="text-2xl font-semibold">Physicians</h1>
        <Link
          href={buildExportHref(filters)}
          className="text-sm px-3 py-1.5 border border-black/15 dark:border-white/15 rounded hover:bg-black/5 dark:hover:bg-white/5"
        >
          ⬇ Export CSV
        </Link>
      </div>

      <FilterBar
        q={filters.q}
        state={filters.state}
        taxonomyCodes={filters.taxonomyCodes}
        primaryOnly={filters.primaryOnly}
        includeDeactivated={filters.includeDeactivated}
        activeIrOnly={filters.activeIrOnly}
        sortBy={filters.sortBy}
        states={states}
        total={total}
      />

      <PhysicianTable rows={rows} />

      <Pagination
        page={page}
        pageCount={pageCount}
        total={total}
        perPage={perPage}
        buildHref={(p) => buildPageHref(filters, p)}
      />
    </>
  );
}
