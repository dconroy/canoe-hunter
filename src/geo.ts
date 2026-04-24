import zipcodes from 'zipcodes';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export function coordinatesForZip(postal: string): Coordinates | null {
  const lookup = zipcodes.lookup(postal);

  if (!lookup || typeof lookup.latitude !== 'number' || typeof lookup.longitude !== 'number') {
    return null;
  }

  return {
    latitude: lookup.latitude,
    longitude: lookup.longitude,
  };
}

export function distanceMilesBetween(from: Coordinates | null, to: Coordinates | null): number | null {
  if (!from || !to) {
    return null;
  }

  const earthRadiusMiles = 3958.8;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  const distance = 2 * earthRadiusMiles * Math.asin(Math.sqrt(haversine));
  return Math.round(distance);
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
