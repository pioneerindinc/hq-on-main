import Image from "next/image";
import Link from "next/link";
import { logoutCustomer } from "@/app/actions/customer";

export function CustomerHeader({ name }: { name: string }) {
  return (
    <header className="customer-header">
      <div className="container customer-header-inner">
        <Link href="/" aria-label="HQ on Main home">
          <Image src="/logo_hq_720_720.png" alt="" width={62} height={62} />
        </Link>
        <div>
          <span>Customer center</span>
          <strong>{name}</strong>
        </div>
        <form action={logoutCustomer}>
          <button type="submit">Log out</button>
        </form>
      </div>
    </header>
  );
}
