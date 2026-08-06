import Image from "next/image";
import Link from "next/link";

export function Header() {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link className="brand" href="/" aria-label="HQ on Main home">
          <Image
            src="/logo_hq_720_720.png"
            alt=""
            width={68}
            height={68}
            priority
          />
          <span className="brand-wordmark">
            <strong>HQ on Main</strong>
            <small>Barbershop</small>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/services">Services</Link>
          <Link href="/barbers">Meet the barbers</Link>
          <Link href="/about">About HQ</Link>
          <Link href="/customer/login">Customer login</Link>
        </nav>
        <Link className="button button-primary header-button" href="/book">
          Book now
        </Link>
      </div>
    </header>
  );
}
