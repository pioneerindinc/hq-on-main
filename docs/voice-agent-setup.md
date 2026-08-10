# Vapi + Twilio voice booking foundation

The application exposes one secured Vapi server endpoint:

```text
POST {APP_BASE_URL}/api/voice/vapi
Authorization: Bearer {VAPI_WEBHOOK_SECRET}
```

It supports `list_services`, `list_shop_openings`, `list_barbers`,
`list_available_slots`, and `book_appointment`. The tools read the same
`staff`, `availability`, and `appointments` MongoDB collections used by the web
booking flow.

## 1. Configure the application

Copy the voice variables from `.env.example` into `.env.local` locally and into
your deployment's server-side environment:

```dotenv
APP_BASE_URL=https://your-production-domain.example
VAPI_WEBHOOK_SECRET=generate-a-long-random-secret
BARBERSHOP_TIME_ZONE=America/Indiana/Indianapolis
VAPI_STORE_TRANSCRIPTS=false
```

The endpoint must be deployed on public HTTPS before Vapi can call it. Keep
`VAPI_WEBHOOK_SECRET`, Vapi private keys, and Twilio credentials server-side.
Do not expose them with a `NEXT_PUBLIC_` prefix.

## 2. Create the Vapi assistant

Create an assistant in Vapi and use the complete production prompt in
`docs/vapi-natural-receptionist-prompt.txt`. It is deliberately written to
retain details callers already supplied, ask only for missing information, and
keep multi-tool validation silent.

The key behavior is:

```text
Caller: "Can I get an appointment with Brayden today?"
Assistant: "Sure—what are we doing for you today?"
Caller: "Just a haircut."
[Resolve the service, validate Brayden, and check live slots without speaking.]
Assistant: "Brayden has 2:30 or 4:00 open today. Does either one work?"
```

Create five synchronous custom tools using the definitions in
`docs/vapi-tools.json`. For every tool:

1. Set the server URL to `{APP_BASE_URL}/api/voice/vapi`.
2. Create a Vapi Custom Credential that sends
   `Authorization: Bearer {VAPI_WEBHOOK_SECRET}`.
3. Attach that credential to the tool server.
4. Leave the tool synchronous so the assistant waits for the scheduling result.
5. Attach all five tools to the assistant.

Tool messages must not narrate each internal lookup:

```text
list_services: remove all request-start and request-complete messages
list_barbers: remove all request-start and request-complete messages
list_available_slots: remove all request-start and request-complete messages
book_appointment request-start: Perfect—I'll get that booked for you.
```

Do not add request-complete messages; let the model turn the returned data into
a natural response. This prevents callers from hearing "checking services,"
then "checking barbers," then "checking appointment time" for what should feel
like one action.

Also set the assistant-level server URL to the same endpoint with the same
credential. Enable at least `status-update` and `end-of-call-report` server
messages if you want call lifecycle records in the `voiceCalls` collection.
The app stores the normalized post-call summary in `voiceCalls` and the
chronological webhook timeline in `voiceCallEvents`. Admins can review both in
**Admin Dashboard → Booking calls**.
Transcripts are stored only when `VAPI_STORE_TRANSCRIPTS=true`.

## 3. Connect the Twilio number

In Twilio, buy a voice-capable number or choose an existing one. In Vapi's
Phone Numbers area, import the Twilio number using its Account SID and Auth
Token, then assign the Vapi assistant to that number. Vapi will handle the
Twilio call routing; Twilio should not point directly at the app's scheduling
endpoint.

Store these values only as deployment references if you automate setup later:

```dotenv
VAPI_PRIVATE_API_KEY=
VAPI_ASSISTANT_ID=
VAPI_PHONE_NUMBER_ID=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
```

The current foundation does not call Vapi's management API at runtime, so those
references are not required for inbound booking calls.

For confirmation and reminder texts from the same Twilio number, complete
`docs/twilio-messaging-setup.md`. Voice calls continue through Vapi; the app
sends transactional SMS through Twilio's Messaging API.

## 4. Test before publishing the number

Use Vapi's tool test or a local tunnel and confirm:

1. `list_services` returns the live catalog.
2. `list_shop_openings` returns remaining times across every active barber or
   only the named preferred barber, and defaults to the shop's current local
   date when no date is supplied.
3. `list_barbers` excludes inactive barbers and those who do not offer the
   selected service.
4. `list_available_slots` matches the web booking calendar and excludes booked
   times.
5. `book_appointment` creates one confirmed `appointments` record with
   `source: "voice"`.
6. Replaying the same Vapi tool-call ID returns the original booking instead of
   creating a duplicate.
7. An end-of-call event upserts a record in `voiceCalls`.

You can smoke-test the endpoint before configuring Vapi:

```bash
curl -X POST "$APP_BASE_URL/api/voice/vapi" \
  -H "Authorization: Bearer $VAPI_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "type": "tool-calls",
      "call": { "id": "local-smoke-test" },
      "toolCallList": [{
        "id": "local-list-services-1",
        "function": {
          "name": "list_services",
          "arguments": {}
        }
      }]
    }
  }'
```

The response should contain a `results` array whose `toolCallId` is
`local-list-services-1`. Its `result` value is intentionally a single-line JSON
string, which is the format Vapi expects for synchronous custom tools.

## Production checklist

- Add a human-transfer or callback path for tool failures and requests the
  assistant cannot safely complete.
- Decide whether calls are recorded. Configure the opening disclosure and
  consent flow for the laws that apply to the shop and callers.
- Keep transcript storage off unless there is a defined retention, access, and
  deletion policy.
- Restrict the Vapi credential to this webhook and rotate the shared secret if
  it is exposed.
- Add monitoring for failed tool calls and confirm that MongoDB is reachable
  from the deployed app.
- Test names, phone numbers, dates around daylight-saving changes, full days,
  simultaneous requests, and callers correcting information.
