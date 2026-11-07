import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Chess State Explorer" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const { expired } = await searchParams;
  return (
    <main className="login">
      <div className="card stack">
        <div>
          <h1>♞ Chess State Explorer</h1>
          <p className="muted small">Opening transpositions and game analytics on MySQL + Neo4j.</p>
        </div>
        {expired && <p className="callout callout-warn">Your session expired. Please sign in again.</p>}
        <LoginForm />
        <p className="muted small">Accounts are provisioned by an administrator (<code>npm run user:create</code>). Roles: <b>admin</b> (read/write) and <b>analyst</b> (read-only).</p>
      </div>
    </main>
  );
}
