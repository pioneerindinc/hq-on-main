import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service | HQ on Main",
  description: "Terms for using the Headquarters on Main website, booking services, and appointment messaging program.",
  alternates: { canonical: "https://www.headquartersonmain.com/terms" },
};

export default function TermsPage() {
  return (
    <main className="legal-page">
      <header className="legal-hero">
        <div className="container legal-hero-inner">
          <p className="eyebrow">Website &amp; messaging</p>
          <h1>Terms of Service</h1>
          <p>Effective August 4, 2026</p>
        </div>
      </header>

      <article className="container legal-content">
        <section>
          <h2>Agreement</h2>
          <p>These Terms govern your use of the Headquarters on Main website, customer accounts, appointment booking features, and appointment messaging program. By using these services, you agree to these Terms and our <Link href="/privacy">Privacy Policy</Link>.</p>
        </section>

        <section>
          <h2>Appointments and customer information</h2>
          <p>You agree to provide accurate contact and appointment information. An online or telephone booking is confirmed only after our scheduling system provides confirmation. Appointment availability may change until confirmation is complete. Please contact the shop if you need assistance changing or cancelling an appointment.</p>
        </section>

        <section id="sms-terms">
          <h2>HQ on Main appointment messaging</h2>
          <p>The HQ on Main appointment messaging program sends transactional appointment confirmations and reminders. It does not send promotional or marketing offers. Message frequency is up to two messages per appointment. Message and data rates may apply. Carrier message delivery is not guaranteed.</p>
          <p>Participation is optional. SMS consent is not a condition of booking or purchasing services. Reply STOP to any message to unsubscribe. After opting out, you will no longer receive appointment texts unless you opt in again. Reply HELP for help or contact HQ on Main using the contact information on this website.</p>
          <p>Reply STOP to opt out and HELP for assistance. Wireless carriers are not liable for delayed or undelivered messages.</p>
        </section>

        <section id="sms-consent">
          <h2>How SMS consent is collected</h2>
          <p>During online booking at <Link href="/book">www.headquartersonmain.com/book</Link>, customers may voluntarily select an unchecked SMS consent box after entering their mobile number. The box describes the message type and frequency, possible carrier charges, opt-out instructions, and links to these Terms and the Privacy Policy. Customers may leave it unchecked and still complete their booking.</p>
          <p>For telephone or staff-assisted bookings, the exact consent request is:</p>
          <blockquote>Would you like to receive appointment confirmation and reminder texts from HQ on Main? You may receive up to two messages per appointment. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is optional and is not required to book an appointment.</blockquote>
          <p>SMS consent is recorded only after the customer affirmatively selects the box or clearly answers yes to the verbal request.</p>
        </section>

        <section>
          <h2>Acceptable use</h2>
          <p>You may not misuse the website, attempt unauthorized access, interfere with its operation, submit fraudulent appointments, or use the service in violation of applicable law.</p>
        </section>

        <section>
          <h2>Service availability</h2>
          <p>We may update, suspend, or discontinue website features when reasonably necessary. We do not guarantee that the website, telephone agent, or messaging service will always be uninterrupted or error-free.</p>
        </section>

        <section>
          <h2>Limitation of liability</h2>
          <p>To the extent permitted by law, HQ on Main is not liable for indirect, incidental, or consequential damages arising from use of the website or delayed or undelivered communications. Nothing in these Terms limits rights that cannot legally be limited.</p>
        </section>

        <section>
          <h2>Changes and governing law</h2>
          <p>We may update these Terms from time to time. The effective date identifies the latest version. These Terms are governed by the laws of the State of Indiana, without regard to conflict-of-law principles.</p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>Questions about these Terms may be directed to Headquarters on Main using the contact information published on <Link href="/">our website</Link>.</p>
        </section>
      </article>
    </main>
  );
}
