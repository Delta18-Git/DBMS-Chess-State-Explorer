"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, Knight } from "@/components/Icon";
import { NavProgress } from "@/components/NavProgress";

const groups: { label: string; links: [string, string, string][] }[] = [
  { label: "Browse", links: [["/", "Home", "home"], ["/search", "Search", "search"], ["/games", "Games", "games"], ["/players", "Players", "players"], ["/tournaments", "Tournaments", "trophy"], ["/openings", "Openings", "book"]] },
  { label: "Analyse", links: [["/positions", "Explorer", "explore"], ["/transpositions", "Transpositions", "merge"], ["/repertoires", "Repertoires", "bookmark"]] },
];

export interface ShellUser { name: string; email: string; role: "admin" | "analyst" }

export function Shell({ user, logout, children }: { user: ShellUser; logout: () => Promise<void>; children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const initials = user.name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const links = user.role === "admin" ? [...groups, { label: "Manage", links: [["/admin", "Admin", "key"] as [string, string, string]] }] : groups;

  return (
    <div className={`shell ${open ? "open" : ""}`}>
      <NavProgress />
      <aside className="sidebar" aria-label="Sidebar">
        <Link href="/" className="brand"><span className="brand-mark"><Knight /></span>Chess State Explorer</Link>
        <nav className="nav" aria-label="Main">
          {links.map(g => (
            <div key={g.label} className="nav">
              <div className="nav-label">{g.label}</div>
              {g.links.map(([href, label, icon]) => (
                <Link key={href} href={href} aria-current={active(href) ? "page" : undefined}><Icon name={icon} />{label}</Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="user-card">
          <span className="avatar" aria-hidden>{initials}</span>
          <div className="who">
            <strong className="truncate">{user.name}</strong>
            <span className="truncate" title={user.email}>{user.email}</span>
            <span className={`role ${user.role === "admin" ? "role-admin" : ""}`} title={user.role === "admin" ? "Can import, analyse and edit shared data" : "Reads everything; manages their own repertoires"}>
              <Icon name={user.role === "admin" ? "key" : "explore"} />
              {user.role === "admin" ? "Admin" : "Analyst"}
            </span>
          </div>
          <form action={logout}><button className="icon-btn" title="Sign out" aria-label="Sign out"><Icon name="logout" /></button></form>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" aria-label="Open menu" onClick={() => setOpen(true)}><Icon name="menu" /></button>
          <Link href="/" className="brand-mini row" style={{ gap: 8, color: "var(--ink)", fontWeight: 600 }}><span className="brand-mark" style={{ width: 24, height: 24 }}><Knight /></span><span>Chess State Explorer</span></Link>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
