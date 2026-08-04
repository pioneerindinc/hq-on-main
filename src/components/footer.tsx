import Image from "next/image";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-top">
        <div>
          <Image
            className="footer-logo"
            src="/logo_hq_720_720.png"
            alt="HQ on Main"
            width={120}
            height={120}
          />
        </div>
        <div className="footer-column">
          <h2>Explore</h2>
          <Link href="/services">Services</Link>
          <Link href="/barbers">Meet the barbers</Link>
          <Link href="/about">About HQ</Link>
          <Link href="/book">Book now</Link>
          <Link href="/customer/login">Customer login</Link>
          <Link href="/barber/login">Barber login</Link>
        </div>
        <div className="footer-column">
          <h2>Hours</h2>
          <p>Tue–Fri · 9am–7pm</p>
          <p>Saturday · 8am–4pm</p>
          <p>Sun–Mon · Closed</p>
        </div>
        <div className="footer-column">
          <h2>Find us</h2>
          <p>Main Street</p>
          <p>Plainfield, IN</p>
          <a href="tel:+13175550192">(317) 555-0192</a>
        </div>
      </div>
      <div className="container footer-bottom">
        <p>© {new Date().getFullYear()} HQ on Main. All rights reserved.</p>
        <p>Built for good hair days.</p>
      </div>
    </footer>
  );
}
