# Twilio appointment confirmations and reminders

The app sends:

- An immediate confirmation when a customer explicitly opts in while booking.
- One reminder approximately 24 hours before a confirmed appointment.

SMS failures do not roll back an appointment. Every attempt is recorded in the
MongoDB `smsMessages` collection. Consent and delivery metadata are stored on
the appointment.

## What you need in Twilio

1. A Twilio project with a positive balance and a messaging-capable number.
2. The Account SID.
3. For production, an API Key SID and API Key Secret. The Auth Token can be
   used for local testing.
4. A Twilio Messaging Service containing the phone number.
5. The required sender registration:
   - US local 10-digit numbers: register an A2P 10DLC Brand and Campaign.
   - US/Canada toll-free numbers: complete Toll-Free verification instead.
6. Advanced Opt-Out enabled on the Messaging Service. Test STOP, START, and
   HELP from a real phone.

The number may also be imported into Vapi. Vapi owns the inbound voice routing,
while this application sends outbound confirmation and reminder messages using
Twilio's Messaging API.

## Environment configuration

Add these server-side variables locally and in production:

```dotenv
TWILIO_ACCOUNT_SID=AC...
TWILIO_API_KEY=SK...
TWILIO_API_KEY_SECRET=...
TWILIO_MESSAGING_SERVICE_SID=MG...
TWILIO_PHONE_NUMBER=+1...

CRON_SECRET=generate-a-different-long-random-secret
TWILIO_REMINDER_HOURS_BEFORE=24
TWILIO_REMINDER_WINDOW_MINUTES=20
BARBERSHOP_TIME_ZONE=America/Indiana/Indianapolis
```

`TWILIO_PHONE_NUMBER` is retained as a fallback sender. When
`TWILIO_MESSAGING_SERVICE_SID` is configured, the Messaging Service is used.

For local testing only, you can omit the API key variables and set:

```dotenv
TWILIO_AUTH_TOKEN=...
```

Do not expose any of these values with a `NEXT_PUBLIC_` prefix.

## Schedule reminders

Configure the hosting provider's scheduler to send an authenticated POST every
10 to 15 minutes:

```text
POST https://your-domain.example/api/cron/appointment-reminders
Authorization: Bearer {CRON_SECRET}
```

The endpoint:

1. Selects confirmed appointments with recorded SMS consent.
2. Finds appointments inside the configured reminder window.
3. Atomically claims each appointment to avoid duplicate sends.
4. Sends the reminder and stores `reminderSentAt` and the Twilio Message SID.
5. Releases failed claims so a later run can retry.

With the default settings, a scheduler running every 15 minutes sends reminders
between 23 hours 40 minutes and 24 hours before the appointment.

## Consent behavior

The public booking flow leaves SMS consent unchecked. Staff portals contain a
checkbox that should be selected only after the customer agrees. The Vapi tool
requires an explicit `smsConsent` boolean and the voice prompt tells the agent
to ask separately.

Every outbound template identifies HQ on Main and includes “Reply STOP to
unsubscribe.” Twilio applies its sender block list to future messages after an
opt-out.

## Test checklist

1. Use a real opted-in mobile number to create a test appointment.
2. Confirm the appointment remains successful if Twilio is temporarily
   unavailable.
3. Check `smsMessages` for the Twilio Message SID and queued status.
4. Temporarily shorten `TWILIO_REMINDER_HOURS_BEFORE` to exercise the reminder
   endpoint.
5. Call the reminder endpoint twice and verify only one reminder is sent.
6. Reply STOP and verify future sends are blocked; reply START to restore
   consent where supported.
