"use client";

import { useState } from "react";

export function BarberSetupLink({ token, barberName }: { token: string; barberName: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/barber/setup?token=${encodeURIComponent(token)}`;
  async function copy() {
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setCopied(true);
  }
  return <div className="barber-invite-banner" role="status">
    <div><strong>Setup link ready for {barberName}.</strong><p>It expires in seven days and can only be used once. Share it privately.</p></div>
    <div><button className="button button-secondary" type="button" onClick={copy}>{copied ? "Copied" : "Copy setup link"}</button><a className="button button-primary" href={path} target="_blank" rel="noreferrer">Open link</a></div>
  </div>;
}
