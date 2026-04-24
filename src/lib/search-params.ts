import { IR_TAXONOMY_CODES } from "./taxonomies";

// Next.js searchParams give us string | string[] | undefined per key.
type Raw = Record<string, string | string[] | undefined>;

function first(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function many(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") return [raw];
  return [];
}

export interface ParsedFilters {
  q: string;
  state: string;
  cbsaCode: string;
  taxonomyCodes: string[];
  primaryOnly: boolean;
  includeDeactivated: boolean;
  activeIrOnly: boolean;
  practiceSetting: string; // "", "OBL", "FACILITY", "MIXED"
  sortBy: "lastName" | "enumerationDate" | "irVolume";
  page: number;
}

export function parseFilters(raw: Raw): ParsedFilters {
  const validTax = new Set(IR_TAXONOMY_CODES as readonly string[]);
  const sortRaw = first(raw.sort);
  const sortBy: ParsedFilters["sortBy"] =
    sortRaw === "enumerationDate" || sortRaw === "irVolume"
      ? sortRaw
      : "lastName";
  const settingRaw = first(raw.setting)?.trim().toUpperCase() ?? "";
  const validSettings = new Set(["OBL", "FACILITY", "MIXED"]);
  return {
    q: first(raw.q)?.trim() ?? "",
    state: first(raw.state)?.trim().toUpperCase() ?? "",
    cbsaCode: first(raw.cbsa)?.trim() ?? "",
    taxonomyCodes: many(raw.tax).filter((c) => validTax.has(c)),
    primaryOnly: first(raw.primary) === "1",
    includeDeactivated: first(raw.inactive) === "1",
    activeIrOnly: first(raw.active) === "1",
    practiceSetting: validSettings.has(settingRaw) ? settingRaw : "",
    sortBy,
    page: Math.max(1, parseInt(first(raw.page) ?? "1", 10) || 1),
  };
}

function appendFilters(params: URLSearchParams, filters: ParsedFilters): void {
  if (filters.q) params.set("q", filters.q);
  if (filters.state) params.set("state", filters.state);
  if (filters.cbsaCode) params.set("cbsa", filters.cbsaCode);
  for (const code of filters.taxonomyCodes) params.append("tax", code);
  if (filters.primaryOnly) params.set("primary", "1");
  if (filters.includeDeactivated) params.set("inactive", "1");
  if (filters.activeIrOnly) params.set("active", "1");
  if (filters.practiceSetting) params.set("setting", filters.practiceSetting);
  if (filters.sortBy !== "lastName") params.set("sort", filters.sortBy);
}

export function buildPageHref(filters: ParsedFilters, page: number): string {
  const params = new URLSearchParams();
  appendFilters(params, filters);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export function buildExportHref(filters: ParsedFilters): string {
  const params = new URLSearchParams();
  appendFilters(params, filters);
  const qs = params.toString();
  return qs ? `/api/export?${qs}` : "/api/export";
}
