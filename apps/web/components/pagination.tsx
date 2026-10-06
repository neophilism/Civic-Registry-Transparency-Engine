import Link from "next/link";

import {
  toUrlSearchParams,
  type PublicSearchParams,
} from "../lib/search-params";

export function Pagination({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  params: PublicSearchParams;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));

  if (pages <= 1) return null;

  const hrefFor = (targetPage: number) => {
    const query = toUrlSearchParams(params, {
      page: targetPage,
    });
    return `${basePath}?${query.toString()}`;
  };

  return (
    <nav
      className="pagination"
      aria-label="Search result pages"
    >
      <div>
        {page > 1 ? (
          <Link href={hrefFor(page - 1)}>← Previous</Link>
        ) : (
          <span aria-disabled="true">← Previous</span>
        )}
      </div>
      <span>
        Page {page} of {pages}
      </span>
      <div>
        {page < pages ? (
          <Link href={hrefFor(page + 1)}>Next →</Link>
        ) : (
          <span aria-disabled="true">Next →</span>
        )}
      </div>
    </nav>
  );
}
