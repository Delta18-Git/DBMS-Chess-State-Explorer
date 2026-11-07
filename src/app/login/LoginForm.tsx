"use client";

import { useActionState } from "react";
import { login } from "@/app/actions";
import { PasswordInput } from "@/components/PasswordInput";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="form">
      <label className="field"><span className="field-label">Email</span>
        <input name="email" type="email" autoComplete="username" required maxLength={254} autoFocus />
      </label>
      <label className="field"><span className="field-label">Password</span>
        <PasswordInput name="password" autoComplete="current-password" required maxLength={256} />
      </label>
      {state?.error && <p role="alert" className="msg msg-error" style={{ textAlign: "center" }}>{state.error}</p>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
