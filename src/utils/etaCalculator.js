const EARTH_RADIUS_METERS = 6_371_000
const CITY_AVERAGE_SPEED_KMH = 22

function toRadians(degrees) {
  return (degrees * Math.PI) / 180
}

export function distanceBetween(pointA, pointB) {
  const latitudeDelta = toRadians(pointB.lat - pointA.lat)
  const longitudeDelta = toRadians(pointB.lon - pointA.lon)
  const latitudeA = toRadians(pointA.lat)
  const latitudeB = toRadians(pointB.lat)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

export function isHeadingTowardStop(vehicle, stop) {
  const latitudeA = toRadians(vehicle.lat)
  const latitudeB = toRadians(stop.lat)
  const longitudeDelta = toRadians(stop.lon - vehicle.lon)
  const y = Math.sin(longitudeDelta) * Math.cos(latitudeB)
  const x = Math.cos(latitudeA) * Math.sin(latitudeB) -
    Math.sin(latitudeA) * Math.cos(latitudeB) * Math.cos(longitudeDelta)
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
  const difference = Math.abs(((vehicle.heading - bearing + 540) % 360) - 180)

  return difference <= 100 || distanceBetween(vehicle, stop) <= 100
}

export function calculateArrivalMinutes(stop, vehicle, speedKmh) {
  const distanceKm = distanceBetween(stop, vehicle) / 1000
  const safeSpeed = Number.isFinite(speedKmh) && speedKmh >= 5
    ? Math.min(speedKmh, 60)
    : CITY_AVERAGE_SPEED_KMH

  return Math.max(0, Math.ceil((distanceKm / safeSpeed) * 60))
}
