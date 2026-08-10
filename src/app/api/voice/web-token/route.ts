import jwt from "jsonwebtoken";

type VapiAssistantResponse = {
  orgId?: string;
};

let cachedOrgId: string | undefined;

async function getVapiOrgId(privateKey: string, assistantId: string) {
  if (cachedOrgId) return cachedOrgId;

  const response = await fetch(`https://api.vapi.ai/assistant/${encodeURIComponent(assistantId)}`, {
    headers: { Authorization: `Bearer ${privateKey}` },
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`Vapi assistant lookup failed with ${response.status}.`);

  const assistant = (await response.json()) as VapiAssistantResponse;
  if (!assistant.orgId) throw new Error("The Vapi assistant response did not include an organization ID.");

  cachedOrgId = assistant.orgId;
  return assistant.orgId;
}

function requestOrigin(request: Request) {
  const headers = request.headers;
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const url = new URL(request.url);
  const host = forwardedHost || headers.get("host") || url.host;
  const protocol = forwardedProto || url.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

export async function POST(request: Request) {
  const privateKey = process.env.VAPI_PRIVATE_API_KEY;
  const assistantId = process.env.VAPI_ASSISTANT_ID;

  if (!privateKey || !assistantId) {
    return Response.json({ error: "Voice booking is not configured." }, { status: 503 });
  }

  const allowedOrigin = requestOrigin(request);
  const browserOrigin = request.headers.get("origin");
  if (browserOrigin && browserOrigin !== allowedOrigin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }

  try {
    const orgId = await getVapiOrgId(privateKey, assistantId);
    const token = jwt.sign(
      {
        orgId,
        token: {
          tag: "public",
          restrictions: {
            enabled: true,
            allowedOrigins: [allowedOrigin],
            allowedAssistantIds: [assistantId],
            allowTransientAssistant: false,
          },
        },
      },
      privateKey,
      { expiresIn: "5m" },
    );

    return Response.json(
      { token, assistantId },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    console.error("Unable to create a Vapi web-call token:", error);
    return Response.json({ error: "Unable to start voice booking." }, { status: 502 });
  }
}
