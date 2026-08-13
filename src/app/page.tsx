import Image from "next/image";
import Link from "next/link";

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h12M11 5l5 5-5 5" />
    </svg>
  );
}

export default function Home() {
  return (
    <main>
      <section className="hero" aria-labelledby="hero-title">
        <Image
          className="hero-image"
          src="/main_image.jpg"
          alt="Barber finishing a precision fade in a modern barbershop"
          fill
          priority
          sizes="100vw"
        />
        <div className="hero-shade" />
        <div className="container hero-content">
          <p className="eyebrow">Headquarters on Main · Plainfield, Indiana</p>
          <h1 id="hero-title">
            Look sharp.
            <br />
            <span>Feel ready.</span>
          </h1>
          <div className="hero-actions">
            <Link className="button button-primary" href="/book">
              Book Now <ArrowIcon />
            </Link>
            <Link className="text-link" href="/services">
              Explore services
            </Link>
          </div>
        </div>
      </section>

    </main>
  );
}
