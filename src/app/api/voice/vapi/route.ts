import {
  isAuthorizedVoiceRequest,
  recordVoiceEvent,
  runVoiceTool,
  type VoiceToolCall,
} from "@/lib/voice-scheduling";

export const runtime = "nodejs";

type VapiMessage = {
  type?: string;
  call?: { id?: string };
  toolCallList?: VoiceToolCall[];
  toolCalls?: VoiceToolCall[];
  [key: string]: unknown;
};

export async function POST(request: Request) {
  if (!isAuthorizedVoiceRequest(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { message?: VapiMessage };
  try {
    body = (await request.json()) as { message?: VapiMessage };
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const message = body.message;
  if (!message || typeof message !== "object") {
    return Response.json({ error: "Missing Vapi message." }, { status: 400 });
  }

  const candidateToolCalls = message.toolCallList ?? message.toolCalls;
  const toolCalls = Array.isArray(candidateToolCalls) ? candidateToolCalls : [];
  if (message.type === "tool-calls" || toolCalls.length > 0) {
    const callId =
      typeof message.call?.id === "string"
        ? message.call.id
        : "";
    const [results] = await Promise.all([
      Promise.all(toolCalls.map((toolCall) => runVoiceTool(toolCall, callId))),
      recordVoiceEvent(message).catch((error) => {
        console.error("Could not record Vapi tool event", error);
      }),
    ]);
    return Response.json({ results });
  }

  try {
    await recordVoiceEvent(message);
  } catch (error) {
    console.error("Could not record Vapi event", error);
  }

  return Response.json({ received: true });
}
