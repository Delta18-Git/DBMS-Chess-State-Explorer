import Link from "next/link";

export default function NotFound() {
  return (
    <main className="login">
      <div className="card stack">
        <h1>Not found</h1>
        <p className="muted">That game, position or page does not exist (it may have been deleted).</p>
        <Link href="/" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>Back to dashboard</Link>
      </div>
    </main>
  );
}
