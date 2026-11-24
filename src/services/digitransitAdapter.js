import { decodePolyline } from './digitransit.js'

function placeStop(place) {
  const stop = place.stop || place
  const lat = stop.lat ?? place.lat
  const lon = stop.lon ?? place.lon
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('Digitransiti vastuses puuduvad peatuse koordinaadid.')
  }
  return {
    id: stop.gtfsId || `location:${lat},${lon}`,
    name: stop.name || place.name,
    coordinates: { lat, lon },
  }
}

function time(value) {
  const result = new Date(value)
  if (!value || !Number.isFinite(result.getTime())) {
    throw new Error('Digitransiti vastuses on vigane kellaaeg.')
  }
  return result
}

function routeType(leg, routes) {
  if (leg.mode === 'TRAM') return 'tram'
  if (leg.mode === 'TROLLEYBUS') return 'trolley'
  if (leg.mode === 'RAIL') return 'rail'
  if (leg.mode !== 'BUS') throw new Error(`Toetamata ühistranspordiliik: ${leg.mode}`)
  const matches = routes.filter((route) =>
    route.number === leg.route?.shortName &&
    route.name.toLocaleLowerCase('et') === leg.route?.longName?.toLocaleLowerCase('et'),
  )
  return matches.length === 1 ? matches[0].type : 'bus'
}

export function adaptItineraries(itineraries, { from, to, routes = [] }) {
  return itineraries.map((itinerary) => {
    const departsAt = time(itinerary.start)
    const arrivesAt = time(itinerary.end)
    const routeLegs = itinerary.legs.map((leg, index) => {
      const start = time(leg.start?.scheduledTime)
      const end = time(leg.end?.scheduledTime)
      const origin = placeStop(leg.from)
      const destination = placeStop(leg.to)
      if (index === 0 && !leg.from.stop) origin.name = from.name
      if (index === itinerary.legs.length - 1 && !leg.to.stop) destination.name = to.name
      const shapePoints = leg.legGeometry?.points
        ? decodePolyline(leg.legGeometry.points)
        : [origin.coordinates, destination.coordinates]
      const durationMinutes = Math.max(1, Math.ceil(leg.duration / 60))
      if (!leg.transitLeg) {
        if (leg.mode !== 'WALK') throw new Error(`Toetamata liikumisviis: ${leg.mode}`)
        return {
          type: 'walk', mode: leg.mode, from: origin, to: destination,
          departsAt: start, arrivalAt: end, durationMinutes,
          distanceMeters: Math.round(leg.distance), shapePoints, pathStops: [],
        }
      }

      const matchingRoute = routes.find((route) =>
        route.type === 'county' && route.number === leg.route?.shortName &&
        route.name.toLocaleLowerCase('et') === leg.route?.longName?.toLocaleLowerCase('et'),
      )
      const transportType = routeType(leg, routes)
      const intermediate = (leg.stopCalls || []).flatMap((call) => {
        const stop = call.stopLocation
        const schedule = call.schedule?.time
        if (stop?.__typename !== 'Stop' || stop.gtfsId === origin.id || stop.gtfsId === destination.id ||
            schedule?.__typename !== 'ArrivalDepartureTime' || !schedule.arrival || !schedule.departure) return []
        const arrivalAt = time(schedule.arrival)
        const departureAt = time(schedule.departure)
        if (arrivalAt < start || departureAt > end) return []
        return [{ stop: placeStop(stop), arrivalAt, departureAt }]
      })
      const stopTimes = [
        { stop: origin, arrivalAt: start, departureAt: start },
        ...intermediate,
        { stop: destination, arrivalAt: end, departureAt: end },
      ]
      return {
        type: 'transit', tripId: leg.trip?.gtfsId || leg.id,
        trackingKey: `${leg.trip?.gtfsId || leg.id}:${leg.serviceDate}:${start.getTime()}`,
        routeId: matchingRoute?.id || leg.route?.gtfsId,
        line: leg.route?.shortName || '?', routeName: leg.route?.longName || '',
        transportType, headsign: leg.headsign, destination: leg.headsign,
        pathStops: stopTimes.map((entry) => entry.stop), stopTimes, shapePoints,
        stopCount: stopTimes.length - 1, durationMinutes,
        departsAt: start, arrivalAt: end, isLive: false, vehicle: null,
        estimatedDepartureAt: start, estimatedDelayMinutes: null,
        transferWalkMinutes: 0, index,
      }
    })
    const legs = routeLegs.filter((leg) => leg.type === 'transit')
    return {
      id: routeLegs.map((leg) => leg.trackingKey || `${leg.type}:${leg.departsAt.getTime()}`).join('/'),
      from: legs[0]?.pathStops[0] || placeStop(itinerary.legs[0].from),
      to: placeStop(itinerary.legs.at(-1).to),
      originLabel: from.name,
      destinationLabel: to.name,
      departsAt, arrivesAt, durationMinutes: Math.max(1, Math.ceil((arrivesAt - departsAt) / 60_000)),
      legs, routeLegs, isWalkingOnly: !legs.length,
      walkMinutes: routeLegs.filter((leg) => leg.type === 'walk').reduce((sum, leg) => sum + leg.durationMinutes, 0),
      transferMinutes: 0,
      dataSource: 'Digitransit',
    }
  })
}
