export const SERVICE_CATALOG = [
  {
    id: "haircut",
    name: "Haircut",
    price: "$35",
    description:
      "Precision hair cut with hot lather and a straight razor neck shave.",
  },
  {
    id: "mens-cut-wash-beard-trim",
    name: "Mens Cut, Wash and Beard Trim Package",
    price: "$55",
    description:
      "Save by scheduling a mens cut, wash, and beard trim as a package deal.",
  },
  {
    id: "straight-razor-shave",
    name: "Straight Razor Shave",
    price: "$40",
    description:
      "Old-school straight razor shave with a hot towel, pre-shave, and aftershave lotion.",
  },
  {
    id: "kids-haircut",
    name: "Kids Haircut (13 and under)",
    price: "$30",
    description: "A precision haircut for kids age 13 and under.",
  },
  {
    id: "beard-trim",
    name: "Beard Trim",
    price: "$20",
    description:
      "Beard trimmed to the desired length and finished with straight razor edges.",
  },
  {
    id: "senior-haircut",
    name: "Senior Haircut (60+)",
    price: "$25",
    description:
      "Precision hair cut with hot lather and a straight razor neck shave for guests age 60+.",
  },
  {
    id: "designs",
    name: "Designs",
    price: "TBD",
    description:
      "Custom designs are available. Pricing will be determined by the barber.",
  },
  {
    id: "wash",
    name: "Wash",
    price: "$15",
    description: "A thorough shampoo and rinse to leave your hair clean and refreshed.",
  },
] as const;

export const SERVICE_NAMES = SERVICE_CATALOG.map((service) => service.name);
export const SERVICE_IDS = SERVICE_CATALOG.map((service) => service.id);

export function serviceById(id: string) {
  return SERVICE_CATALOG.find((service) => service.id === id);
}
