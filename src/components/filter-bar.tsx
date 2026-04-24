import Link from "next/link";
import { IR_TAXONOMIES, IR_TAXONOMY_CODES } from "@/lib/taxonomies";
import type { MetroOption } from "@/lib/physicians";

interface FilterBarProps {
  q: string;
  state: string;
  cbsaCode: string;
  taxonomyCodes: string[];
  primaryOnly: boolean;
  includeDeactivated: boolean;
  activeIrOnly: boolean;
  practiceSetting: string;
  sortBy: "lastName" | "enumerationDate" | "irVolume";
  states: string[];
  metros: MetroOption[];
  total: number;
}

export function FilterBar({
  q,
  state,
  cbsaCode,
  taxonomyCodes,
  primaryOnly,
  includeDeactivated,
  activeIrOnly,
  practiceSetting,
  sortBy,
  states,
  metros,
  total,
}: FilterBarProps) {
  const hasFilters =
    q ||
    state ||
    cbsaCode ||
    taxonomyCodes.length > 0 ||
    primaryOnly ||
    includeDeactivated ||
    activeIrOnly ||
    practiceSetting ||
    sortBy !== "lastName";

  return (
    <form
      method="GET"
      action="/"
      className="mb-6 border border-black/10 dark:border-white/10 rounded p-4 flex flex-col gap-4 bg-black/[0.02] dark:bg-white/[0.02]"
    >
      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col text-sm flex-1 min-w-[200px]">
          <span className="opacity-70 mb-1">Search (name, NPI, credentials)</span>
          <input
            name="q"
            defaultValue={q}
            placeholder="Khayat, 1780941583, MD PhD…"
            className="border border-black/15 dark:border-white/15 rounded px-3 py-1.5 bg-transparent"
          />
        </label>

        <label className="flex flex-col text-sm">
          <span className="opacity-70 mb-1">Practice state</span>
          <select
            name="state"
            defaultValue={state}
            className="border border-black/15 dark:border-white/15 rounded px-3 py-1.5 bg-transparent min-w-[100px]"
          >
            <option value="">All</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-sm min-w-[260px]">
          <span className="opacity-70 mb-1">Metro (CBSA)</span>
          <select
            name="cbsa"
            defaultValue={cbsaCode}
            className="border border-black/15 dark:border-white/15 rounded px-3 py-1.5 bg-transparent"
          >
            <option value="">All</option>
            {metros.slice(0, 100).map((m) => (
              <option key={m.code} value={m.code}>
                {m.name} ({m.practiceCount})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-sm">
          <span className="opacity-70 mb-1" title="Derived from Medicare PUF place-of-service mix">
            Practice setting
          </span>
          <select
            name="setting"
            defaultValue={practiceSetting}
            className="border border-black/15 dark:border-white/15 rounded px-3 py-1.5 bg-transparent min-w-[130px]"
          >
            <option value="">All</option>
            <option value="OBL">OBL (office)</option>
            <option value="FACILITY">Facility (hosp/ASC)</option>
            <option value="MIXED">Mixed</option>
          </select>
        </label>

        <div className="flex flex-col text-sm">
          <span className="opacity-70 mb-1">Taxonomies</span>
          <div className="flex gap-3 py-1.5">
            {IR_TAXONOMY_CODES.map((code) => (
              <label key={code} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="tax"
                  value={code}
                  defaultChecked={taxonomyCodes.includes(code)}
                />
                <span title={IR_TAXONOMIES[code]}>{shortName(code)}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-1.5 text-sm py-1.5">
          <input type="checkbox" name="primary" value="1" defaultChecked={primaryOnly} />
          <span>Primary only</span>
        </label>

        <label className="flex items-center gap-1.5 text-sm py-1.5">
          <input
            type="checkbox"
            name="active"
            value="1"
            defaultChecked={activeIrOnly}
          />
          <span title="Billed ≥25 IR Medicare services in 2023">Active IR only</span>
        </label>

        <label className="flex items-center gap-1.5 text-sm py-1.5">
          <input
            type="checkbox"
            name="inactive"
            value="1"
            defaultChecked={includeDeactivated}
          />
          <span>Include deactivated</span>
        </label>

        <label className="flex flex-col text-sm">
          <span className="opacity-70 mb-1">Sort by</span>
          <select
            name="sort"
            defaultValue={sortBy}
            className="border border-black/15 dark:border-white/15 rounded px-3 py-1.5 bg-transparent min-w-[140px]"
          >
            <option value="lastName">Name (A–Z)</option>
            <option value="irVolume">IR volume (high→low)</option>
            <option value="enumerationDate">Career length</option>
          </select>
        </label>

        <button
          type="submit"
          className="px-4 py-1.5 text-sm border border-black/20 dark:border-white/20 rounded bg-black text-white dark:bg-white dark:text-black font-medium"
        >
          Apply
        </button>

        {hasFilters && (
          <Link
            href="/"
            className="px-4 py-1.5 text-sm border border-black/15 dark:border-white/15 rounded opacity-70 hover:opacity-100"
          >
            Clear
          </Link>
        )}
      </div>

      <div className="text-sm opacity-70 flex justify-between">
        <span>{total.toLocaleString()} physicians match</span>
      </div>
    </form>
  );
}

function shortName(code: string): string {
  if (code === "2085R0204X") return "V&IR";
  if (code === "2085N0700X") return "Neuro";
  if (code === "2085P0229X") return "Peds";
  return code;
}
