/**
 * Resolve a friendly city label from coordinates for onboarding display.
 * Coords stay on the profile; the label is UI-only and never stored.
 */

export type ReverseGeocodeResult = {
  locality?: string;
  city?: string;
  region?: string;
  country?: string;
};

/** Prefer the most specific place name the geocoder returned. */
export function formatCityLabel(parts: ReverseGeocodeResult): string | null {
  const locality = parts.locality?.trim();
  const city = parts.city?.trim();
  const region = parts.region?.trim();
  const place = locality || city;
  if (place && region && place !== region) return `${place}, ${region}`;
  if (place) return place;
  if (region) return region;
  const country = parts.country?.trim();
  return country || null;
}

/**
 * Browser-safe reverse geocode (BigDataCloud client endpoint, no API key).
 * Returns null when the network fails or nothing useful comes back.
 */
export async function reverseGeocodeCity(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const url =
    `https://api.bigdatacloud.net/data/reverse-geocode-client` +
    `?latitude=${encodeURIComponent(String(lat))}` +
    `&longitude=${encodeURIComponent(String(lon))}` +
    `&localityLanguage=en`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    locality?: string;
    city?: string;
    principalSubdivision?: string;
    countryName?: string;
  };
  return formatCityLabel({
    locality: data.locality,
    city: data.city,
    region: data.principalSubdivision,
    country: data.countryName,
  });
}
