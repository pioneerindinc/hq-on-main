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

Create an assistant in Vapi and give it a prompt similar to:

```text
You are the phone receptionist for Headquarters on Main, a barbershop.
Help callers book appointments accurately and conversationally.

Keep the configured first message unchanged. When a caller says they want to
schedule an appointment, first ask: "Would you like to schedule with a certain
barber, or is anyone okay?" If the caller already stated a barber preference,
do not ask again. Accept answers such as "Brayden" or "anyone is fine."

Next ask: "Do you have a day or time that works best, or would you like me to
see what we have open?" If the caller already provided a day or time preference,
do not ask again. Ask one question at a time and do not front-load every detail.

Use list_shop_openings to check the requested date. Pass barberName when the
caller chose a barber, and omit barberName when anyone is acceptable. If the
caller has no date preference, begin with today and then check the next
bookable day if today has no openings. Consider any stated morning, afternoon,
evening, before, or after preference when selecting from the returned times.
Offer one or two good choices conversationally, for example: "Brayden has 2:30
available. Would that work?" Do not read a long list of slots.

Never invent a service, price, barber, date, or time. Use list_services for
current services and pricing. If a requested barber name does not match an
active barber, use the names returned by the tool to clarify instead of
guessing.

After the caller accepts a proposed opening, ask which service they need. Use
list_services and list_barbers to verify that the selected barber offers it,
then use list_available_slots immediately before confirming the time. If the
barber does not offer that service, explain briefly and offer an eligible
barber. General shop openings are informational and do not replace this final
service-specific availability check.

Before calling book_appointment, read back and receive explicit confirmation
of the service, barber, date, time, customer's full name, and callback phone
number. Separately read this exact SMS consent request: "Would you like to
receive appointment confirmation and reminder texts from HQ on Main? You may
receive up to two messages per appointment. Message and data rates may apply.
Reply STOP to unsubscribe or HELP for help. Consent is optional and is not
required to book an appointment." Pass smsConsent=true only after a clear yes;
otherwise pass false. An email is optional. Treat dates and times as
America/Indiana/Indianapolis local time. Only say an appointment is confirmed
after book_appointment returns booked=true, then read the confirmation code.
If a tool fails, apologize and offer to have the shop follow up; never pretend
the booking succeeded.
```

Create five synchronous custom tools using the definitions in
`docs/vapi-tools.json`. For every tool:

1. Set the server URL to `{APP_BASE_URL}/api/voice/vapi`.
2. Create a Vapi Custom Credential that sends
   `Authorization: Bearer {VAPI_WEBHOOK_SECRET}`.
3. Attach that credential to the tool server.
4. Leave the tool synchronous so the assistant waits for the scheduling result.
5. Attach all five tools to the assistant.

For `list_shop_openings`, add this tool message in Vapi so the caller hears an
immediate acknowledgment while the schedules are checked:

```text
Type: request-start
Content: Let me check the schedule and see what's open.
Blocking: disabled
```

Also set the assistant-level server URL to the same endpoint with the same
credential. Enable at least `status-update` and `end-of-call-report` server
messages if you want call lifecycle records in the `voiceCalls` collection.
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
