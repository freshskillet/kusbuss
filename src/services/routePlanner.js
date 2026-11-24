import { calculateArrivalMinutes, distanceBetween, isHeadingTowardStop } from '../utils/etaCalculator.js'

function findLiveArrival(line, origin, vehicles) {
  return vehicles
    .filter((vehicle) => vehicle.line.toLowerCase() === line.line.toLowerCase())
    .filter((vehicle) => vehicle.transportType === line.transportType)
    .filter((vehicle) => isHeadingTowardStop(vehicle, origin.coordinates))
    .map((vehicle) => ({
      vehicle,
      distance: distanceBetween(origin.coordinates, { lat: vehicle.lat, lon: vehicle.lon }),
    }))
    .filter(({ distance }) => distance <= 3000)
    .sort((a, b) => a.distance - b.distance)[0] || null
}

function createLeg(line, fromIndex, toIndex, stops, vehicles, now) {
  const pathStops = line.stopIds.slice(fromIndex, toIndex + 1).map((id) => stops.find((stop) => stop.id === id))
  const stopCount = toIndex - fromIndex
  const durationMinutes = stopCount * line.minutesPerStop
  const arrival = findLiveArrival(line, pathStops[0], vehicles)
  const waitMinutes = arrival
    ? calculateArrivalMinutes(
      pathStops[0].coordinates,
      { lat: arrival.vehicle.lat, lon: arrival.vehicle.lon },
      arrival.vehicle.speed,
    )
    : 5

  return {
    line: line.line,
    transportType: line.transportType,
    destination: line.destination,
    pathStops,
    stopCount,
    durationMinutes,
    waitMinutes,
    isLive: Boolean(arrival),
    isSimulated: Boolean(arrival?.vehicle.isSimulated),
    vehicle: arrival?.vehicle || null,
    arrivalDistance: arrival?.distance ?? null,
    arrivalAt: new Date(now.getTime() + waitMinutes * 60_000),
  }
}

function makeTrip(legs, from, to, now) {
  const waitMinutes = legs[0].waitMinutes
  const durationMinutes = legs.reduce((total, leg) => total + leg.durationMinutes, 0)
  const transferMinutes = legs.length > 1 ? 5 : 0
  const totalMinutes = waitMinutes + durationMinutes + transferMinutes

  const journeySteps = legs.flatMap((leg, legIndex) => {
    const steps = leg.pathStops.map((stop, stopIndex) => ({
      stop,
      line: leg.line,
      transferTo: legIndex < legs.length - 1 && stopIndex === leg.pathStops.length - 1
        ? legs[legIndex + 1].line
        : null,
    }))
    return legIndex ? steps.slice(1) : steps
  })

  return {
    id: legs.map((leg) => `${leg.line}-${leg.pathStops[0].id}-${leg.pathStops.at(-1).id}`).join('/'),
    from,
    to,
    legs,
    stopCount: legs.reduce((total, leg) => total + leg.stopCount, 0),
    durationMinutes: durationMinutes + transferMinutes,
    totalMinutes,
    arrivesAt: new Date(now.getTime() + totalMinutes * 60_000),
    isLive: legs[0].isLive,
    vehicle: legs[0].vehicle,
    pathStops: legs.flatMap((leg, index) => index ? leg.pathStops.slice(1) : leg.pathStops),
    journeySteps,
  }
}

export function planRoutes({ fromStop, toStop, stops, lines, vehicles = [], now = new Date() }) {
  if (!fromStop || !toStop || fromStop.id === toStop.id) return []

  const directTrips = []
  for (const line of lines) {
    const fromIndex = line.stopIds.indexOf(fromStop.id)
    const toIndex = line.stopIds.indexOf(toStop.id)
    if (fromIndex !== -1 && toIndex > fromIndex) {
      directTrips.push(makeTrip([
        createLeg(line, fromIndex, toIndex, stops, vehicles, now),
      ], fromStop, toStop, now))
    }
  }

  const transferTrips = []
  if (!directTrips.length) {
    for (const firstLine of lines) {
      const startIndex = firstLine.stopIds.indexOf(fromStop.id)
      if (startIndex < 0) continue

      for (let transferIndex = startIndex + 1; transferIndex < firstLine.stopIds.length; transferIndex += 1) {
        const transferId = firstLine.stopIds[transferIndex]
        if (transferId === toStop.id) continue
        const transferStop = stops.find((stop) => stop.id === transferId)
        if (!transferStop) continue

        for (const secondLine of lines) {
          if (secondLine.id === firstLine.id || secondLine.transportType === firstLine.transportType && secondLine.line === firstLine.line) continue
          const secondStartIndex = secondLine.stopIds.indexOf(transferId)
          const destinationIndex = secondLine.stopIds.indexOf(toStop.id)
          if (secondStartIndex < 0 || destinationIndex <= secondStartIndex) continue

          const legs = [
            createLeg(firstLine, startIndex, transferIndex, stops, vehicles, now),
            createLeg(secondLine, secondStartIndex, destinationIndex, stops, vehicles, now),
          ]
          transferTrips.push(makeTrip(legs, fromStop, toStop, now))
        }
      }
    }
  }

  const uniqueTrips = directTrips.length ? directTrips : transferTrips
  return uniqueTrips
    .sort((a, b) => a.totalMinutes - b.totalMinutes)
    .filter((trip, index, trips) => trips.findIndex((candidate) =>
      candidate.legs.map((leg) => `${leg.line}:${leg.pathStops[0].id}:${leg.pathStops.at(-1).id}`).join('|') ===
      trip.legs.map((leg) => `${leg.line}:${leg.pathStops[0].id}:${leg.pathStops.at(-1).id}`).join('|'),
    ) === index)
    .slice(0, 4)
}
