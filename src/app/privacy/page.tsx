import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | HQ on Main",
  description: "Learn how Headquarters on Main collects, uses, and protects customer and SMS information.",
  alternates: { canonical: "https://www.headquartersonmain.com/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <header className="legal-hero">
        <div className="container legal-hero-inner">
          <p className="eyebrow">Your information</p>
          <h1>Privacy Policy</h1>
          <p>Effective 08/04/2026</p>
        </div>
      </header>

      <article className="container legal-content">
        <section>
          <h2>Overview</h2>
          <p>Headquarters on Main, also known as HQ on Main, respects your privacy. This policy explains how we collect, use, disclose, and protect information when you use our website, create an account, book an appointment, contact the shop, or choose to receive text messages.</p>
        </section>

        <section>
          <h2>Information we collect</h2>
          <p>Depending on how you interact with us, we may collect:</p>
          <ul>
            <li>Your name, email address, and telephone number.</li>
            <li>Appointment details, including service, barber, date, time, and notes.</li>
            <li>Customer account and authentication information.</li>
            <li>Your SMS consent choice, the date and method of consent, and messaging activity.</li>
            <li>Basic technical information needed to operate and secure the website.</li>
          </ul>
        </section>

        <section>
          <h2>How we use information</h2>
          <p>We use information to:</p>
          <ul>
            <li>Schedule, manage, confirm, and remind you about appointments.</li>
            <li>Provide and maintain customer and staff accounts.</li>
            <li>Respond to questions and provide customer support.</li>
            <li>Operate, secure, troubleshoot, and improve our services.</li>
            <li>Meet legal, regulatory, and recordkeeping obligations.</li>
          </ul>
        </section>

        <section id="sms-privacy">
          <h2>SMS privacy and consent</h2>
          <p>If you expressly opt in, HQ on Main may send appointment confirmations and appointment reminders to the mobile number you provide. You may receive up to two messages per appointment. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent to receive text messages is optional and is not a condition of booking or purchasing services.</p>
          <p>Mobile information, SMS opt-in data, and consent records will not be shared, sold, rented, or transferred to third parties or affiliates for marketing or promotional purposes. We may disclose information to telecommunications providers and service providers solely as necessary to deliver messages, operate the appointment service, prevent fraud, or comply with law.</p>
        </section>

        <section>
          <h2>When we disclose information</h2>
          <p>We may provide limited information to vendors that help us host the website, maintain our database, authenticate accounts, process communications, and deliver SMS messages. These providers may use the information only to perform services for HQ on Main. We may also disclose information when required by law, to protect rights and safety, or as part of a business reorganization.</p>
        </section>

        <section>
          <h2>Retention and security</h2>
          <p>We retain information for as long as reasonably necessary to provide services, maintain appointment and consent records, resolve disputes, and satisfy legal obligations. We use reasonable administrative and technical safeguards, but no method of storage or transmission is completely secure.</p>
        </section>

        <section>
          <h2>Your choices</h2>
          <p>You can decline SMS consent and still book an appointment. You can withdraw SMS consent at any time by replying STOP. You may update account information through the Customer Center or contact HQ on Main using the contact information published on this website.</p>
        </section>

        <section>
          <h2>Children&apos;s privacy</h2>
          <p>Customer accounts and appointment communications are intended for adults and guardians arranging services. We do not knowingly request that children under 13 create accounts or provide mobile-message consent.</p>
        </section>

        <section>
          <h2>Changes to this policy</h2>
          <p>We may update this policy as our services or legal obligations change. The effective date at the top of this page identifies the latest version.</p>
        </section>

        <section>
          <h2>Contact us</h2>
          <p>For questions or privacy requests, contact Headquarters on Main using the contact information published on <Link href="/">our website</Link>.</p>
          <p>Please also review our <Link href="/terms">Terms of Service</Link>.</p>
        </section>
      </article>
    </main>
  );
}
