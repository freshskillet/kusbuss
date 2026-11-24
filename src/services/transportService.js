const GPS_URL = '/api/tallinn/gps.txt'
const REQUEST_TIMEOUT_MS = 8000
const FALLBACK_SPEEDS = [19, 24, 28, 16, 22, 31]

function parseGpsText(text) {
  const rows = text.trim().split(/\r?\n/).filter(Boolean)
  if (rows.length === 0) return []

  const firstRow = rows[0].toLowerCase()
  const hasHeader = firstRow.includes('transporttype') || firstRow.includes('vehicleid')
  const dataRows = hasHeader ? rows.slice(1) : rows

  return dataRows.flatMap((row) => {
    const columns = row.split(/[;,\t]/).map((value) => value.trim().replace(/^"|"$/g, ''))
    if (columns.length < 7) return []

    const [rawType, rawLine, rawLon, rawLat, rawSpeed, rawHeading, rawVehicleId] = columns
    const longitude = Number(rawLon)
    const latitude = Number(rawLat)
    const speed = Number(rawSpeed)
    const heading = Number(rawHeading)
    const transportType = normalizeTransportType(rawType)

    if (
      !transportType ||
      !rawLine ||
      !rawVehicleId ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      Math.abs(longitude) > 180 ||
      Math.abs(latitude) > 90
    ) return []

    return [{
      transportType,
      line: rawLine,
      lon: longitude,
      lat: latitude,
      speed: Number.isFinite(speed) ? speed : 0,
      heading: Number.isFinite(heading) ? heading : 0,
      vehicleId: rawVehicleId,
      isSimulated: false,
    }]
  })
}

function normalizeTransportType(value) {
  const type = value.toLowerCase()
  if (type.includes('tram')) return 'tram'
  if (type.includes('troll')) return 'trolley'
  if (type.includes('bus')) return 'bus'
  return null
}

function destinationPoint(origin, bearingDegrees, distanceMeters) {
  const angularDistance = distanceMeters / 6_371_000
  const bearing = (bearingDegrees * Math.PI) / 180
  const latitude = (origin.lat * Math.PI) / 180
  const longitude = (origin.lon * Math.PI) / 180
  const destinationLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
    Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  )
  const destinationLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude),
  )

  return {
    lat: (destinationLatitude * 180) / Math.PI,
    lon: (destinationLongitude * 180) / Math.PI,
  }
}

function bearingBetween(from, to) {
  const latitudeA = (from.lat * Math.PI) / 180
  const latitudeB = (to.lat * Math.PI) / 180
  const longitudeDelta = ((to.lon - from.lon) * Math.PI) / 180
  const y = Math.sin(longitudeDelta) * Math.cos(latitudeB)
  const x = Math.cos(latitudeA) * Math.sin(latitudeB) -
    Math.sin(latitudeA) * Math.cos(latitudeB) * Math.cos(longitudeDelta)

  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

function createSimulatedVehicles(stops) {
  const routeAnchors = new Map()
  stops.forEach((stop) => {
    stop.routes.forEach((route) => {
      if (route.transportType === 'county') return
      const key = `${route.transportType}-${route.line}`
      if (!routeAnchors.has(key)) routeAnchors.set(key, { stop, route })
    })
  })

  return [...routeAnchors.values()].map(({ stop, route }, index) => {
    const bearing = (index * 63) % 360
    const distance = 450 + ((index * 197) % 1050)
    const position = destinationPoint(stop.coordinates, (bearing + 180) % 360, distance)

    return {
      transportType: route.transportType,
      line: route.line,
      lon: position.lon,
      lat: position.lat,
      speed: FALLBACK_SPEEDS[index % FALLBACK_SPEEDS.length],
      heading: bearingBetween(position, stop.coordinates),
      vehicleId: `demo-${stop.id}-${route.line}-${index}`,
      isSimulated: true,
    }
  })
}

export async function getVehicles(stops) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(GPS_URL, { signal: controller.signal })
    if (!response.ok) throw new Error(`GPS-andmete päring ebaõnnestus (${response.status})`)

    const text = await response.text()
    const vehicles = parseGpsText(text)
    if (vehicles.length > 0) return { vehicles, source: 'live' }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.warn('Tallinna GPS-andmed pole saadaval; kasutatakse demoandmeid.', error)
    }
  } finally {
    window.clearTimeout(timeout)
  }

  return { vehicles: createSimulatedVehicles(stops), source: 'simulated' }
}
