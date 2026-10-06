import Link from "next/link";

export interface Breadcrumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({
  items,
}: {
  items: Breadcrumb[];
}) {
  return (
    <nav
      className="breadcrumbs"
      aria-label="Breadcrumb"
    >
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {item.href ? (
              <Link href={item.href}>{item.label}</Link>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
