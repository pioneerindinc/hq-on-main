import Image from "next/image";
import Link from "next/link";
import { logout } from "@/app/actions/auth";

export function StaffHeader({
  name,
  area,
}: {
  name: string;
  area: "Admin" | "Barber";
}) {
  return (
    <header className="staff-header">
      <div className="container staff-header-inner">
        <Link href="/" aria-label="HQ on Main home">
          <Image src="/logo_hq_720_720.png" alt="" width={58} height={58} />
        </Link>
        <div className="staff-identity">
          <span>{area} portal</span>
          <strong>{name}</strong>
        </div>
        <form action={logout}>
          <button className="staff-logout" type="submit">Log out</button>
        </form>
      </div>
    </header>
  );
}
