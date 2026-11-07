"use client";

import { useState } from "react";

/** Player photo (Wikimedia Commons) with an initials fallback if there is none or it fails to load. */
export function Avatar({ name, photo, size = "" }: { name: string; photo?: string | null; size?: "" | "sm" | "lg" }) {
  const [failed, setFailed] = useState(false);
  const cls = `avatar ${size ? `avatar-${size}` : ""}`;
  const display = /^[^,]+, [^,]+$/.test(name) ? name.split(", ").reverse().join(" ") : name;
  const initials = display.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  // eslint-disable-next-line @next/next/no-img-element
  return photo && !failed ? <img className={cls} src={photo} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span className={cls} aria-hidden>{initials}</span>;
}
