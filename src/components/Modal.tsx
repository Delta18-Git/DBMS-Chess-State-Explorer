"use client";

import { useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

/** A button that opens a native <dialog> (used for admin forms so they never clutter the page). */
export function Modal({ label, title, icon, children, className = "btn" }: { label: ReactNode; title: string; icon?: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.showModal()}>{icon && <Icon name={icon} />}{label}</button>
      <dialog ref={ref} className="modal" onClick={e => { if (e.target === ref.current) ref.current?.close(); }}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => ref.current?.close()}><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
      </dialog>
    </>
  );
}
