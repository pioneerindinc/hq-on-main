import type { Metadata } from "next";
import Link from "next/link";
import { SERVICE_CATALOG } from "@/lib/services";

export const metadata: Metadata = {
  title: "Services | HQ on Main",
  description:
    "Explore haircuts, beard services, and premium grooming at HQ on Main in Plainfield.",
};

export default function ServicesPage() {
  return (
    <main>
      <section className="inner-hero">
        <div className="inner-hero-mark" aria-hidden="true">01</div>
        <div className="container inner-hero-content">
          <p className="eyebrow">The menu</p>
          <h1>Services,<br /><span>refined.</span></h1>
          <p>
            Straightforward grooming, done with intention. Every service starts
            with a conversation and ends when every detail is right.
          </p>
        </div>
      </section>

      <section className="page-section service-menu" aria-labelledby="service-menu-title">
        <div className="container">
          <div className="page-section-heading">
            <div>
              <p className="eyebrow">Choose your service</p>
              <h2 id="service-menu-title">Built around you.</h2>
            </div>
          </div>
          <div className="detailed-service-list">
            {SERVICE_CATALOG.map((service, index) => (
              <article className="detailed-service" key={service.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{service.name}</h3>
                  <p>{service.description}</p>
                </div>
                <strong>{service.price}</strong>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="detail-band">
        <div className="container detail-band-grid">
          <div>
            <p className="eyebrow">The HQ difference</p>
            <h2>No shortcuts.<br />No guesswork.</h2>
          </div>
          <div className="detail-points">
            <article>
              <span>01</span>
              <div><h3>Consultation first</h3><p>We listen, ask the right questions, and make a plan before the clippers come on.</p></div>
            </article>
            <article>
              <span>02</span>
              <div><h3>Built to last</h3><p>Your cut is shaped to grow out clean, not just look good when you leave the chair.</p></div>
            </article>
            <article>
              <span>03</span>
              <div><h3>Finished right</h3><p>Clean lines, thoughtful styling, and practical advice to keep the look working at home.</p></div>
            </article>
          </div>
        </div>
      </section>

      <section className="page-cta">
        <div className="container page-cta-inner">
          <div><p className="eyebrow">Ready when you are</p><h2>Claim your chair.</h2></div>
          <Link className="button button-primary" href="/book">Book an appointment →</Link>
        </div>
      </section>
    </main>
  );
}
