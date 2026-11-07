"use client";

import { useState } from "react";
import { Icon } from "./Icon";

export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw">
      <input {...props} type={show ? "text" : "password"} />
      <button type="button" className="icon-btn" onClick={() => setShow(s => !s)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>
        <Icon name={show ? "eyeOff" : "eye"} />
      </button>
    </div>
  );
}
