"use client";

import { useActionState } from "react";
import { login } from "@/app/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="form">
      <label className="field"><span className="field-label">Email</span>
        <input name="email" type="email" autoComplete="username" required maxLength={254} />
      </label>
      <label className="field"><span className="field-label">Password</span>
        <input name="password" type="password" autoComplete="current-password" required maxLength={256} />
      </label>
      <div className="form-actions">
        <button className="btn btn-primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
        <span role="alert" className="msg msg-error">{state?.error}</span>
      </div>
    </form>
  );
}
