import Link from "next/link";
import type { ReactNode } from "react";
import { currentUser } from "@/lib/web/api";
import { logout } from "@/app/actions";
import { Nav } from "./Nav";

// Every page below requires a valid session: currentUser() redirects to /login otherwise.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand"><span aria-hidden>♞</span> Chess State Explorer</Link>
        <Nav admin={user.role === "admin"} />
        <div className="sidebar-foot stack" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 6 }}>
            <span className="small" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</span>
            <span className={`badge ${user.role === "admin" ? "badge-admin" : ""}`}>{user.role}</span>
          </div>
          <form action={logout}><button className="btn btn-ghost" style={{ width: "100%" }}>Sign out</button></form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
