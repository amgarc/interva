import Link from "next/link";

interface PaginationProps {
  page: number;
  pageCount: number;
  total: number;
  perPage: number;
  buildHref: (page: number) => string;
}

export function Pagination({ page, pageCount, total, perPage, buildHref }: PaginationProps) {
  if (pageCount <= 1) return null;

  const firstIdx = (page - 1) * perPage + 1;
  const lastIdx = Math.min(page * perPage, total);

  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <span className="opacity-70">
        {firstIdx.toLocaleString()}–{lastIdx.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex gap-1">
        <PageLink href={buildHref(1)} disabled={page === 1} label="« First" />
        <PageLink href={buildHref(page - 1)} disabled={page === 1} label="‹ Prev" />
        <span className="px-3 py-1 opacity-70">
          Page {page} / {pageCount}
        </span>
        <PageLink href={buildHref(page + 1)} disabled={page === pageCount} label="Next ›" />
        <PageLink href={buildHref(pageCount)} disabled={page === pageCount} label="Last »" />
      </div>
    </div>
  );
}

function PageLink({
  href,
  disabled,
  label,
}: {
  href: string;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return <span className="px-3 py-1 border border-black/10 dark:border-white/10 rounded opacity-40">{label}</span>;
  }
  return (
    <Link
      href={href}
      className="px-3 py-1 border border-black/15 dark:border-white/15 rounded hover:bg-black/5 dark:hover:bg-white/5"
    >
      {label}
    </Link>
  );
}
