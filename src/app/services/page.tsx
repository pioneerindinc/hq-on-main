import type { Metadata } from "next";
import Link from "next/link";
import { getServiceCatalog } from "@/lib/services";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Services | HQ on Main",
  description:
    "Explore haircuts, beard services, and premium grooming at HQ on Main in Plainfield.",
};

export default async function ServicesPage() {
  const services = await getServiceCatalog();
  return (
    <main>

      <section className="page-section service-menu" aria-labelledby="service-menu-title">
        <div className="container">
          <div className="page-section-heading">
            <div>
              <p className="eyebrow">Choose your service</p>
              <h2 id="service-menu-title">Built around you.</h2>
            </div>
          </div>
          <div className="detailed-service-list">
            {services.map((service, index) => (
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
        <div className="container page-cta-inner">
          <div><p className="eyebrow">Ready when you are</p><h2>Claim your chair.</h2></div>
          <Link className="button button-primary" href="/book">Book an appointment →</Link>
        </div>
      </section>
    </main>
  );
}
