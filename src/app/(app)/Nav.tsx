"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const groups: { title: string; links: [string, string][] }[] = [
  { title: "Overview", links: [["/", "Dashboard"], ["/search", "Search"]] },
  { title: "Graph · Neo4j", links: [["/transpositions", "Transpositions"], ["/positions", "Position explorer"]] },
  { title: "Data · MySQL", links: [["/games", "Games"], ["/players", "Players"], ["/openings", "Openings"], ["/tournaments", "Tournaments"], ["/repertoires", "Repertoires"]] },
];

export function Nav({ admin }: { admin: boolean }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav className="nav" aria-label="Main">
      {groups.map(g => (
        <div key={g.title}>
          <div className="nav-group">{g.title}</div>
          {g.links.map(([href, label]) => <Link key={href} href={href} aria-current={active(href) ? "page" : undefined}>{label}</Link>)}
        </div>
      ))}
      <div className="nav-group">System</div>
      <Link href="/admin" aria-current={active("/admin") ? "page" : undefined}>{admin ? "Admin & audit" : "Audit log"}</Link>
    </nav>
  );
}
