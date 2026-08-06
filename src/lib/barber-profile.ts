export function barberPhotoUrl(
  barberId: string,
  photoUpdatedAt?: Date | string | number | null,
) {
  const timestamp = photoUpdatedAt ? new Date(photoUpdatedAt).valueOf() : 0;
  const version = Number.isFinite(timestamp) && timestamp > 0 ? String(timestamp) : "current";
  return `/api/barbers/${encodeURIComponent(barberId)}/photo/${version}`;
}
