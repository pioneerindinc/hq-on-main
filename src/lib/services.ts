import { getMongoClient } from "@/lib/mongodb";

export type ServiceCatalogItem = {
  id: string;
  name: string;
  price: string;
  description: string;
  sortOrder: number;
};

export const DEFAULT_SERVICE_CATALOG: ServiceCatalogItem[] = [
  {
    id: "haircut",
    name: "Haircut",
    price: "$35",
    description: "Precision hair cut with hot lather and a straight razor neck shave.",
    sortOrder: 10,
  },
  {
    id: "mens-cut-wash-beard-trim",
    name: "Mens Cut, Wash and Beard Trim Package",
    price: "$55",
    description: "Save by scheduling a mens cut, wash, and beard trim as a package deal.",
    sortOrder: 20,
  },
  {
    id: "straight-razor-shave",
    name: "Straight Razor Shave",
    price: "$40",
    description: "Old-school straight razor shave with a hot towel, pre-shave, and aftershave lotion.",
    sortOrder: 30,
  },
  {
    id: "kids-haircut",
    name: "Kids Haircut (13 and under)",
    price: "$30",
    description: "A precision haircut for kids age 13 and under.",
    sortOrder: 40,
  },
  {
    id: "beard-trim",
    name: "Beard Trim",
    price: "$20",
    description: "Beard trimmed to the desired length and finished with straight razor edges.",
    sortOrder: 50,
  },
  {
    id: "senior-haircut",
    name: "Senior Haircut (60+)",
    price: "$25",
    description: "Precision hair cut with hot lather and a straight razor neck shave for guests age 60+.",
    sortOrder: 60,
  },
  {
    id: "designs",
    name: "Designs",
    price: "TBD",
    description: "Custom designs are available. Pricing will be determined by the barber.",
    sortOrder: 70,
  },
  {
    id: "wash",
    name: "Wash",
    price: "$15",
    description: "A thorough shampoo and rinse to leave your hair clean and refreshed.",
    sortOrder: 80,
  },
];

type ServiceDocument = ServiceCatalogItem & {
  createdAt?: Date;
  updatedAt?: Date;
};

async function servicesCollection() {
  const client = await getMongoClient();
  return client.db("hqonmain").collection<ServiceDocument>("services");
}

export async function ensureServiceCatalog() {
  const services = await servicesCollection();
  await services.createIndex({ id: 1 }, { unique: true });
  if (await services.estimatedDocumentCount()) return services;

  const now = new Date();
  try {
    await services.bulkWrite(
      DEFAULT_SERVICE_CATALOG.map((service) => ({
        updateOne: {
          filter: { id: service.id },
          update: { $setOnInsert: { ...service, createdAt: now, updatedAt: now } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
  }
  return services;
}

export async function getServiceCatalog() {
  const services = await ensureServiceCatalog();
  return services
    .find({}, { projection: { _id: 0, id: 1, name: 1, price: 1, description: 1, sortOrder: 1 } })
    .sort({ sortOrder: 1, name: 1 })
    .toArray() as Promise<ServiceCatalogItem[]>;
}

export async function getServiceById(id: string) {
  const services = await ensureServiceCatalog();
  return services.findOne(
    { id },
    { projection: { _id: 0, id: 1, name: 1, price: 1, description: 1, sortOrder: 1 } },
  ) as Promise<ServiceCatalogItem | null>;
}
