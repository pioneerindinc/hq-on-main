This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Customer phone identity

Customers authenticate with an SMS one-time code; customer passwords are no longer used. Online, staff, POS, and Vapi booking paths resolve the same `customers` collection by canonical E.164 phone number and store a controlled `bookingSource` on each appointment.

Set these server-only variables before using customer sign-in:

```bash
CUSTOMER_OTP_SECRET=a-random-secret-at-least-32-characters-long
TWILIO_ACCOUNT_SID=
TWILIO_API_KEY=
TWILIO_API_KEY_SECRET=
TWILIO_MESSAGING_SERVICE_SID=
```

`TWILIO_AUTH_TOKEN` plus `TWILIO_ACCOUNT_SID` remains a supported fallback. Do not expose any of these values through `NEXT_PUBLIC_` variables.

Before deploying the schema change, back up MongoDB and preview the migration:

```bash
npm run migrate:customer-phone
```

The preview does not write data. Review its invalid-phone and duplicate counts, then apply it during a quiet booking window:

```bash
npm run migrate:customer-phone -- --apply
```

The migration preserves customer IDs and history, chooses the oldest record as canonical for an exact normalized-phone group, flags rather than deletes duplicate records, links strong phone matches, backfills appointment booking sources, and creates the partial unique phone index. Records without a usable phone remain preserved with `status: needs_phone`.

The Vapi scheduling endpoint also accepts a `lookup_customer` tool call with an optional `phone` argument. When it is omitted, the backend uses the call's stored caller ID. Caller ID is used only for operational matching and never marks a customer phone as verified. Configure that tool in Vapi if you want the assistant to check identity before collecting booking details; `book_appointment` independently resolves the customer again, so it remains duplicate-safe.

Manual duplicate merging is intentionally separate from automatic resolution. `mergeCustomerRecords` transfers appointment ownership in a transaction, retains the duplicate record as `merged`, and writes a `customerMergeAudits` entry rather than deleting history. It should only be exposed through an owner-authorized review workflow.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
