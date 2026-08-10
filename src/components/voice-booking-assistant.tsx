"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type Vapi from "@vapi-ai/web";

type CallStatus = "idle" | "connecting" | "active" | "ending" | "error";
type CallActivity = "listening" | "speaking";

type WebTokenResponse = {
  token?: string;
  assistantId?: string;
};

function MicrophoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="3" width="8" height="12" rx="4" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
    </svg>
  );
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();

  if (normalized.includes("permission") || normalized.includes("notallowed")) {
    return "Microphone access was blocked. Allow microphone access for this site, then try again.";
  }

  if (normalized.includes("notfound") || normalized.includes("device")) {
    return "We could not find a microphone on this device.";
  }

  return "We could not start the voice assistant. Please try again or use Book Now.";
}

export function VoiceBookingAssistant() {
  const pathname = usePathname();
  const vapiRef = useRef<Vapi | null>(null);
  const mountedRef = useRef(true);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [activity, setActivity] = useState<CallActivity>("listening");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const vapi = vapiRef.current;
      vapiRef.current = null;
      if (vapi) void vapi.stop().catch(() => undefined);
    };
  }, []);

  const startCall = async () => {
    setErrorMessage("");

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setErrorMessage("Voice booking requires a secure browser connection and microphone access.");
      return;
    }

    setStatus("connecting");

    try {
      const tokenResponse = await fetch("/api/voice/web-token", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const credentials = (await tokenResponse.json()) as WebTokenResponse;
      if (!tokenResponse.ok || !credentials.token || !credentials.assistantId) {
        throw new Error("Voice booking is not configured.");
      }

      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      permissionStream.getTracks().forEach((track) => track.stop());

      const { default: VapiClient } = await import("@vapi-ai/web");
      if (!mountedRef.current) return;

      const vapi = new VapiClient(credentials.token);
      vapiRef.current = vapi;

      vapi.on("call-start", () => {
        if (!mountedRef.current) return;
        setStatus("active");
        setActivity("listening");
      });
      vapi.on("speech-start", () => {
        if (mountedRef.current) setActivity("speaking");
      });
      vapi.on("speech-end", () => {
        if (mountedRef.current) setActivity("listening");
      });
      vapi.on("call-end", () => {
        vapiRef.current = null;
        if (!mountedRef.current) return;
        setStatus("idle");
        setActivity("listening");
      });
      vapi.on("error", (error: unknown) => {
        if (!mountedRef.current) return;
        if (vapiRef.current === vapi) vapiRef.current = null;
        void vapi.stop().catch(() => undefined);
        setErrorMessage(friendlyError(error));
        setStatus("error");
      });

      const call = await vapi.start(credentials.assistantId);
      if (!call && mountedRef.current) {
        vapiRef.current = null;
        setStatus("error");
        setErrorMessage("We could not connect the voice assistant. Please try again.");
      }
    } catch (error) {
      const vapi = vapiRef.current;
      vapiRef.current = null;
      if (vapi) void vapi.stop().catch(() => undefined);
      if (!mountedRef.current) return;
      setStatus("error");
      setErrorMessage(friendlyError(error));
    }
  };

  const endCall = async () => {
    const vapi = vapiRef.current;
    if (!vapi) {
      setStatus("idle");
      return;
    }

    setStatus("ending");
    try {
      await vapi.stop();
    } finally {
      vapiRef.current = null;
      if (mountedRef.current) setStatus("idle");
    }
  };

  if (/^\/(admin|barber|pos)(\/|$)/.test(pathname)) return null;

  const inCall = status === "active" || status === "ending";

  return (
    <aside className={`voice-booking${inCall ? " voice-booking-active" : ""}`} aria-live="polite">
      {status === "idle" ? (
        <button className="voice-booking-launch" type="button" onClick={startCall}>
          <span className="voice-booking-icon"><MicrophoneIcon /></span>
          <span className="voice-booking-launch-copy">
            <strong>Talk to Our Booking Assistant</strong>
            <small>Requires a microphone and speakers</small>
          </span>
        </button>
      ) : (
        <div className="voice-booking-panel">
          <div className="voice-booking-panel-heading">
            <span className={`voice-booking-status-dot${inCall ? " is-live" : ""}`} />
            <div>
              <strong>
                {status === "connecting" && "Connecting…"}
                {status === "active" && (activity === "speaking" ? "Assistant is speaking" : "Listening…")}
                {status === "ending" && "Ending call…"}
                {status === "error" && "Couldn’t connect"}
              </strong>
              <small>
                {inCall ? "HQ on Main booking assistant" : "Book an appointment by voice"}
              </small>
            </div>
          </div>

          {status === "error" && <p className="voice-booking-error">{errorMessage}</p>}
          {status === "connecting" && <p className="voice-booking-note">Please allow microphone access when prompted.</p>}
          {status === "active" && <p className="voice-booking-note">Your microphone is in use for this call.</p>}

          <div className="voice-booking-actions">
            {inCall ? (
              <button type="button" className="voice-booking-end" onClick={endCall} disabled={status === "ending"}>
                End Call
              </button>
            ) : status === "error" ? (
              <>
                <button type="button" className="voice-booking-retry" onClick={startCall}>Try Again</button>
                <button type="button" className="voice-booking-dismiss" onClick={() => setStatus("idle")}>Close</button>
              </>
            ) : null}
          </div>
        </div>
      )}
    </aside>
  );
}
