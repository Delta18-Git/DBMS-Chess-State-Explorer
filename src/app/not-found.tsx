import Link from "next/link";
import { Knight } from "@/components/Icon";

export default function NotFound() {
  return (
    <main className="login">
      <div className="card login-card">
        <div className="brand-mark"><Knight /></div>
        <h1>Not found</h1>
        <p className="tagline">That game, player or position does not exist (it may have been deleted).</p>
        <Link href="/" className="btn btn-primary">Back to home</Link>
      </div>
    </main>
  );
}
