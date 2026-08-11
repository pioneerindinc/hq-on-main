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
        <div className="container story-grid">
          <div className="story-image">
            <Image
              src="/main_image.jpg"
              alt="A barber at work inside HQ on Main"
              fill
              sizes="(max-width: 850px) 100vw, 48vw"
            />
            <span>Plainfield · Indiana</span>
          </div>
          <div className="story-copy">
            <p className="eyebrow">Our story</p>
            <p className="story-lead">
              HQ on Main was created to bring old-school barbershop care into a
              space that feels current, welcoming, and distinctly local.
            </p>
            <p className="story-lead">
              Headquarters Barbershop has been a staple to the town of
              Plainfield since 1970. 
            </p>
            <br></br>
            <p className="story-lead">
              Barbershops may be the place to go when you want a fresh, new
              look, but they are also a classic gathering spot in local
              communities. At Headquarters on Main Barbershop, our goal is to
              provide a warm welcome to everyone who comes through the door. We
              love creating a comfortable atmosphere as well as offering
              personal service that transitions guests from customers to family.
            </p>
            <br></br>
            <p className="story-lead">
              With every men&apos;s haircut, you get to enjoy a hot lather, straight
              razor neck shave, and hot towel finish. Come join our family
              atmosphere! 
            </p>
            <br></br>
            <p className="story-lead">
              Get in touch to book a service or stop in! We look
              forward to serving the Plainfield and surrounding Communities for
              Generations to come! Also serving Indianapolis, Mooresville, Avon,
              Danville, Greencastle, Brownsburg, Hendricks County.
            </p>
          </div>
        </div>
      </section>

      <section className="detail-band">
        <div className="container page-cta-inner">
          <div>
            <p className="eyebrow">Come see us</p>
            <h2>Your chair is waiting.</h2>
          </div>
          <Link className="button button-primary" href="/book">
            Book your first visit →
          </Link>
        </div>
      </section>
    </main>
  );
}
