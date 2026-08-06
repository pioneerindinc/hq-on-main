import { Binary, ObjectId } from "mongodb";
import { getMongoClient } from "@/lib/mongodb";

type BarberPhoto = {
  barberId: ObjectId;
  data: Binary;
  contentType: string;
  updatedAt: Date;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) return new Response("Not found", { status: 404 });

  const client = await getMongoClient();
  const photo = await client.db("hqonmain").collection<BarberPhoto>("barberPhotos").findOne({
    barberId: new ObjectId(id),
  });
  if (!photo || !(photo.data instanceof Binary)) {
    return new Response("Not found", { status: 404 });
  }

  const buffer = photo.data.buffer;
  const body = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;

  return new Response(body, {
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
