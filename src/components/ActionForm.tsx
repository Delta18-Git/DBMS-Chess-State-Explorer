"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import type { FormState } from "@/app/actions";
import { Icon } from "./Icon";

type Action = (state: FormState, fd: FormData) => Promise<FormState>;

/** A form bound to a Server Action, showing pending, success and API error states inline. */
export function ActionForm({ action, submit, children, confirm, variant = "primary", className, resetOnSuccess = false, inline = false, icon, small = false }: {
  action: Action; submit: ReactNode; children?: ReactNode; confirm?: string;
  variant?: "primary" | "danger" | "ghost" | "plain" | "solid"; className?: string; resetOnSuccess?: boolean; inline?: boolean; icon?: string; small?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const [toast, setToast] = useState<FormState>(undefined);
  useEffect(() => {
    if (!state) return;
    if (state.ok && resetOnSuccess) ref.current?.reset();
    setToast(state);
    const timer = setTimeout(() => setToast(undefined), state.error ? 6000 : 3500);
    return () => clearTimeout(timer);
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={[inline ? "form-inline" : "form", className].filter(Boolean).join(" ")}
      onSubmit={e => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
    >
      {children}
      <div className="form-actions">
        <button type="submit" className={`btn ${variant === "plain" ? "" : `btn-${variant}`} ${small ? "btn-sm" : ""}`} disabled={pending}>
          {icon && <Icon name={icon} />}{pending ? "Working…" : submit}
        </button>
        {pending && <span className="spinner" aria-hidden />}
        {state?.error && !inline && <span className="msg msg-error">{state.error}</span>}
      </div>
      {toast && (
        <div role="status" aria-live="polite" className={`toast ${toast.error ? "toast-error" : "toast-ok"}`}>
          <Icon name={toast.error ? "x" : "check"} /><span>{toast.error ?? toast.ok}</span>
        </div>
      )}
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
