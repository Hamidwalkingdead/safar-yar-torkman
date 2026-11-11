/** Decode a Google-style encoded polyline (Neshan overview_polyline). */
export function decodePolyline(encoded: string) {
  if (typeof encoded !== "string" || encoded.length > 200_000) {
    throw new Error("Invalid encoded polyline");
  }
  const points: { lat: number; lng: number }[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  const readComponent = () => {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      if (index >= encoded.length || shift > 30) throw new Error("Malformed encoded polyline");
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error("Malformed encoded polyline");
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    latitude += readComponent();
    longitude += readComponent();
    points.push({ lat: latitude / 1e5, lng: longitude / 1e5 });
  }
  return points;
}
