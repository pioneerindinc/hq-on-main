import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getStaffCollection } from "@/lib/auth";
import { barberPhotoUrl } from "@/lib/barber-profile";

export const metadata: Metadata = {
  title: "Meet the Barbers | HQ on Main",
  description:
    "Meet the experienced barbers behind HQ on Main in Plainfield, Indiana.",
};

export default async function BarbersPage() {
  const staff = await getStaffCollection();
  const barbers = await staff
    .find({ role: "barber", active: true })
    .sort({ name: 1 })
    .toArray();

  return (
    <main>
      <section className="page-section barber-profiles" aria-labelledby="barber-list-title">
        <div className="container">
          <div className="page-section-heading">
            <div>
              <p className="eyebrow">Behind the chair</p>
              <h2 id="barber-list-title">Find your barber.</h2>
            </div>
          </div>

          {barbers.length > 0 ? (
            <div className="profile-list">
              {barbers.map((barber) => {
                const firstName = barber.name.split(" ")[0];
                const initials = barber.name
                  .split(" ")
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("");
                return (
                  <article className="profile-card" key={barber._id.toString()}>
                    <div className="profile-visual">
                      {barber.hasPhoto ? (
                        <Image
                          src={barberPhotoUrl(barber._id.toString(), barber.photoUpdatedAt)}
                          alt={`${barber.name}, barber at HQ on Main`}
                          fill
                          sizes="(max-width: 600px) 78vw, (max-width: 1100px) 42vw, 28vw"
                        />
                      ) : (
                        <span>{initials}</span>
                      )}
                    </div>
                    <div className="profile-content">
                      <p className="barber-role">HQ on Main Barber</p>
                      <h3>{barber.name}</h3>
                      {barber.nickname && <p className="profile-nickname">{barber.nickname}</p>}
                      <p className="profile-specialty"></p>
                      <p className="profile-bio">
                        {barber.bio || `Meet ${firstName} at HQ on Main and book a cut tailored to your style.`}
                      </p>
                      <Link className="text-link" href="/book">Book with {firstName}</Link>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="portal-empty">Barber profiles are coming soon.</p>
          )}
        </div>
      </section>

    </main>
  );
}
