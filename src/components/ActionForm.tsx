"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type { FormState } from "@/app/actions";

type Action = (state: FormState, fd: FormData) => Promise<FormState>;

/** A form bound to a Server Action, showing pending, success and API error states inline. */
export function ActionForm({ action, submit, children, confirm, variant = "primary", className, resetOnSuccess = false, inline = false }: {
  action: Action; submit: string; children?: ReactNode; confirm?: string;
  variant?: "primary" | "danger" | "ghost"; className?: string; resetOnSuccess?: boolean; inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnSuccess) ref.current?.reset(); }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={[inline ? "form-inline" : "form", className].filter(Boolean).join(" ")}
      onSubmit={e => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
    >
      {children}
      <div className="form-actions">
        <button type="submit" className={`btn btn-${variant}`} disabled={pending}>{pending ? "Working…" : submit}</button>
        <span role="status" aria-live="polite" className={state?.error ? "msg msg-error" : "msg msg-ok"}>
          {state?.error ?? state?.ok ?? ""}
        </span>
      </div>
    </form>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
