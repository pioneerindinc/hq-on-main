import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Meet the Barbers | HQ on Main",
  description:
    "Meet the experienced barbers behind HQ on Main in Plainfield, Indiana.",
};

const barbers = [
  {
    initials: "DH",
    name: "Damon Hayes",
    role: "Owner · Master Barber",
    years: "12 years behind the chair",
    specialty: "Fades · Classic cuts · Scissor work",
    bio: "Damon built HQ around one simple idea: take the craft seriously without taking yourself too seriously. He is known for thoughtful consultations, clean transitions, and cuts that grow out as well as they start.",
  },
  {
    initials: "MJ",
    name: "Marcus James",
    role: "Senior Barber",
    years: "8 years behind the chair",
    specialty: "Texture · Beard work · Tapers",
    bio: "Marcus brings a detail-first approach to every appointment. From natural texture to precision beard shaping, he knows how to sharpen a look while keeping it unmistakably yours.",
  },
  {
    initials: "TC",
    name: "Trey Collins",
    role: "Barber",
    years: "5 years behind the chair",
    specialty: "Modern styles · Designs · Fades",
    bio: "Trey has an eye for the current without chasing every trend. His chair is the place for crisp fades, creative details, and practical advice on making a new style work every day.",
  },
];

export default function BarbersPage() {
  return (
    <main>
      <section className="inner-hero inner-hero-barbers">
        <div className="inner-hero-mark" aria-hidden="true">HQ</div>
        <div className="container inner-hero-content">
          <p className="eyebrow">The crew</p>
          <h1>Good people.<br /><span>Serious craft.</span></h1>
          <p>
            Different specialties, one standard. Meet the barbers who make HQ
            feel like your shop from the first visit.
          </p>
        </div>
      </section>

      <section className="page-section barber-profiles" aria-labelledby="barber-list-title">
        <div className="container">
          <div className="page-section-heading">
            <div>
              <p className="eyebrow">Behind the chair</p>
              <h2 id="barber-list-title">Find your barber.</h2>
            </div>
            <p>Every chair. The same HQ standard.</p>
          </div>
          <div className="profile-list">
            {barbers.map((barber, index) => (
              <article className="profile-card" key={barber.name}>
                <div className={`profile-visual portrait-${index + 1}`}>
                  <span>{barber.initials}</span>
                  <small>0{index + 1}</small>
                </div>
                <div className="profile-content">
                  <p className="barber-role">{barber.role}</p>
                  <h3>{barber.name}</h3>
                  <p className="profile-years">{barber.years}</p>
                  <p className="profile-bio">{barber.bio}</p>
                  <p className="profile-specialty">{barber.specialty}</p>
                  <Link className="text-link" href="/book">Book with {barber.name.split(" ")[0]}</Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="shop-code">
        <div className="container">
          <p className="eyebrow">Our shop code</p>
          <div className="code-grid">
            <article><strong>Listen first.</strong><p>Your routine, your style, your call. We start by understanding what works for you.</p></article>
            <article><strong>Respect the craft.</strong><p>Details matter. We keep learning, keep refining, and never phone in a service.</p></article>
            <article><strong>Make it easy.</strong><p>Come as you are. Leave feeling sharper, lighter, and ready for whatever is next.</p></article>
          </div>
        </div>
      </section>

      <section className="page-cta">
        <div className="container page-cta-inner">
          <div><p className="eyebrow">Your next cut</p><h2>Meet us at HQ.</h2></div>
          <Link className="button button-primary" href="/book">Choose your barber →</Link>
        </div>
      </section>
    </main>
  );
}
