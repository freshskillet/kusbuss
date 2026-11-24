import { gunzipSync } from 'fflate'

const DATA_URL = '/data/tallinn-gtfs.bin'
let transitDataRequest

function parseStop(row) {
  const [
    id,
    code,
    name,
    lat,
    lon,
    description,
    wheelchairBoarding,
    platform,
    locationType,
    parentStation,
    timezone,
    url,
    spokenName,
    zone,
    alias,
    area,
    authority,
  ] = row

  return {
    id,
    code,
    name,
    coordinates: { lat, lon },
    description,
    wheelchairBoarding,
    platform,
    locationType: Number(locationType),
    parentStation,
    timezone,
    url,
    spokenName,
    zone,
    alias,
    area,
    authority,
    routes: [],
  }
}

function parseRoute(row) {
  return {
    ...row,
    destination: row.name.split(' - ').at(-1) || row.name,
    routeColor: row.color ? `#${row.color}` : '',
  }
}

function distanceMeters(a, b) {
  const latitude = (a.lat + b.lat) * Math.PI / 360
  const x = (b.lon - a.lon) * Math.cos(latitude) * 111_320
  const y = (b.lat - a.lat) * 110_540
  return Math.hypot(x, y)
}

function addNearbyTransfers(stops) {
  const bucketSize = 500
  const latitudeScale = Math.cos(59.45 * Math.PI / 180)
  const buckets = new Map()
  stops.forEach((stop) => { stop.transferOptions = [{ stop, distance: 0, walkMinutes: 0 }] })

  stops.forEach((stop) => {
    const { lat, lon } = stop.coordinates
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return

    const x = lon * latitudeScale * 111_320
    const y = lat * 110_540
    const bucketX = Math.floor(x / bucketSize)
    const bucketY = Math.floor(y / bucketSize)

    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const nearby = buckets.get(`${bucketX + offsetX}:${bucketY + offsetY}`) || []
        nearby.forEach((other) => {
          const distance = distanceMeters(stop.coordinates, other.coordinates)
          if (distance > bucketSize) return
          const walkMinutes = Math.max(1, Math.ceil(distance / 80))
          stop.transferOptions.push({ stop: other, distance, walkMinutes })
          other.transferOptions.push({ stop, distance, walkMinutes })
        })
      }
    }

    const key = `${bucketX}:${bucketY}`
    const bucket = buckets.get(key) || []
    bucket.push(stop)
    buckets.set(key, bucket)
  })
}

function parseTransitData(payload) {
  const stops = payload.stops.map(parseStop)
  const routes = payload.routes.map(parseRoute)
  const shapes = payload.shapes.map(([id, points]) => ({
    id,
    points: points.map(([lat, lon, distance]) => ({ lat, lon, distance })),
  }))
  const routeIdsByStop = stops.map(() => new Set())
  const tripsByStop = new Map()
  const trips = payload.trips.map(([
    id,
    routeIndex,
    serviceIndex,
    direction,
    shapeIndex,
    headsign,
    wheelchairAccessible,
    stopRows,
  ]) => {
    const route = routes[routeIndex]
    const stopTimes = stopRows.map(([
      stopIndex,
      arrivalSeconds,
      departureSeconds,
      shapeDistance,
      pickupType,
      dropOffType,
      stopHeadsign,
    ], index) => {
      const stop = stops[stopIndex]
      if (!routeIdsByStop[stopIndex].has(route.id)) {
        routeIdsByStop[stopIndex].add(route.id)
        stop.routes.push({
          id: route.id,
          line: route.number,
          transportType: route.type,
          destination: stopHeadsign || headsign || route.destination,
          routeName: route.name,
        })
      }

      return {
        stop,
        sequence: index + 1,
        arrivalSeconds,
        departureSeconds,
        shapeDistance,
        pickupType,
        dropOffType,
        headsign: stopHeadsign,
      }
    })

    const trip = {
      id,
      route,
      serviceIndex,
      direction,
      shape: shapes[shapeIndex] || null,
      headsign,
      wheelchairAccessible,
      stopTimes,
    }
    const indexedStopIds = new Set()
    stopTimes.forEach((entry) => {
      if (indexedStopIds.has(entry.stop.id)) return
      indexedStopIds.add(entry.stop.id)
      const stopTrips = tripsByStop.get(entry.stop.id) || []
      stopTrips.push(trip)
      tripsByStop.set(entry.stop.id, stopTrips)
    })
    return trip
  })

  addNearbyTransfers(stops)

  return {
    source: payload.source,
    routes,
    stops,
    services: payload.services,
    exceptions: payload.exceptions,
    trips,
    tripsByStop,
  }
}

export function loadTransitData() {
  if (!transitDataRequest) {
    transitDataRequest = fetch(DATA_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Ametliku sõiduplaani laadimine ebaõnnestus (${response.status})`)
        return response.arrayBuffer()
      })
      .then((buffer) => JSON.parse(new TextDecoder().decode(gunzipSync(new Uint8Array(buffer)))))
      .then(parseTransitData)
      .catch((error) => {
        transitDataRequest = null
        throw error
      })
  }

  return transitDataRequest
}

function dateKey(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
}

export function getActiveServiceIndexes(data, date) {
  const key = dateKey(date)
  const dayIndex = (date.getDay() + 6) % 7
  const active = new Set()

  data.services.forEach((service, index) => {
    if (key >= service.start && key <= service.end && service.weekdays[dayIndex]) active.add(index)
  })
  data.exceptions.forEach(([serviceIndex, exceptionDate, exceptionType]) => {
    if (exceptionDate !== key) return
    if (exceptionType === 1) active.add(serviceIndex)
    if (exceptionType === 2) active.delete(serviceIndex)
  })

  return active
}

export function dateAtServiceTime(serviceDate, seconds) {
  return new Date(
    serviceDate.getFullYear(),
    serviceDate.getMonth(),
    serviceDate.getDate(),
    0,
    0,
    seconds,
  )
}

export function findStop(data, id) {
  return data.stops.find((stop) => stop.id === id) || null
}
