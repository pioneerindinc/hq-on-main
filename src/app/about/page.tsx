import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About | HQ on Main",
  description:
    "Learn about HQ on Main, an independent barbershop built for Plainfield.",
};

export default function AboutPage() {
  return (
    <main>
      <section className="inner-hero inner-hero-about">
        <div className="inner-hero-mark" aria-hidden="true">MAIN</div>
        <div className="container inner-hero-content">
          <p className="eyebrow">This is HQ</p>
          <h1>Built local.<br /><span>Cut different.</span></h1>
          <p>
            An independent barbershop grounded in craft, community, and making
            time in the chair the best part of your week.
          </p>
        </div>
      </section>

      <section className="page-section story-section">
        <div className="container story-grid">
          <div className="story-image">
            <Image
              src="/barbershop-hero.png"
              alt="A barber at work inside HQ on Main"
              fill
              sizes="(max-width: 850px) 100vw, 48vw"
            />
            <span>Plainfield · Indiana</span>
          </div>
          <div className="story-copy">
            <p className="eyebrow">Our story</p>
            <h2>A shop with a point of view.</h2>
            <p className="story-lead">
              HQ on Main was created to bring old-school barbershop care into a
              space that feels current, welcoming, and distinctly local.
            </p>
            <p>
              We believe a great cut begins long before the first pass of the
              clippers. It starts with knowing your name, listening to what you
              want, and understanding how your hair fits your life.
            </p>
            <p>
              That is why we never rush the consultation, never hide behind
              trends, and never call it finished until the details are right.
              HQ is a place to reset, catch up, and walk out ready.
            </p>
          </div>
        </div>
      </section>

      <section className="numbers-section">
        <div className="container numbers-grid">
          <div><strong>10+</strong><span>Years serving the community</span></div>
          <div><strong>4.9</strong><span>Average guest rating</span></div>
          <div><strong>3</strong><span>Barbers, one standard</span></div>
          <div><strong>100%</strong><span>Independent and local</span></div>
        </div>
      </section>

      <section className="page-section values-section">
        <div className="container">
          <div className="page-section-heading">
            <div><p className="eyebrow">What matters here</p><h2>Our values show.</h2></div>
          </div>
          <div className="values-grid">
            <article><span>01</span><h3>Craft over hype</h3><p>Technique, consistency, and a cut that works for you will always matter more than whatever is trending.</p></article>
            <article><span>02</span><h3>People over numbers</h3><p>You are not the next appointment. You are a regular in the making, and we treat your time that way.</p></article>
            <article><span>03</span><h3>Community over everything</h3><p>Plainfield is home. We are proud to build a place where neighbors become friends and everyone belongs.</p></article>
          </div>
        </div>
      </section>

      <section className="page-cta">
        <div className="container page-cta-inner">
          <div><p className="eyebrow">Come see us</p><h2>Your chair is waiting.</h2></div>
          <Link className="button button-primary" href="/book">Book your first visit →</Link>
        </div>
      </section>
    </main>
  );
}
