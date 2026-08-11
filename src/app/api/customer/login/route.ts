export async function POST() {
  return Response.json(
    { message: "Password login has been replaced by mobile phone verification." },
    { status: 410 },
  );
}
