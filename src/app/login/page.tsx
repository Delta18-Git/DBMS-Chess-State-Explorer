import { Knight } from "@/components/Icon";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Chess State Explorer" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const { expired } = await searchParams;
  return (
    <main className="login">
      <div className="card login-card">
        <div className="brand-mark"><Knight /></div>
        <h1>Chess State Explorer</h1>
        <p className="tagline">Every move order to every position, across real tournament games.</p>
        {expired && <p className="note note-warn" style={{ marginBottom: 16 }}>Your session expired. Please sign in again.</p>}
        <LoginForm />
      </div>
    </main>
  );
}
