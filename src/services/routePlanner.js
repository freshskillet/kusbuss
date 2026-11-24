import { getActiveServiceIndexes, dateAtServiceTime } from './transitDataService.js'
import { distanceBetween } from '../utils/etaCalculator.js'

const TRANSFER_MINUTES = 5
const MAX_SEARCH_HOURS = 4
const MAX_LIVE_APPROACH_METERS = 5000
const MAX_DESTINATION_WALK_METERS = 1000
const WALK_DISTANCE_FACTOR = 1.2
const WALK_METERS_PER_MINUTE = 70
const tripInstanceCache = new WeakMap()

function serviceDate(date, offset) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset)
}

function getTripInstances(data, targetDate, relevantStopIds) {
  let dateCache = tripInstanceCache.get(data)
  if (!dateCache) {
    dateCache = new Map()
    tripInstanceCache.set(data, dateCache)
  }
  const cacheKey = `${targetDate.getFullYear()}-${targetDate.getMonth()}-${targetDate.getDate()}:${[...new Set(relevantStopIds)].sort().join(',')}`
  if (dateCache.has(cacheKey)) return dateCache.get(cacheKey)

  const relevantTrips = new Set()
  relevantStopIds.forEach((stopId) => {
    if (data.tripsByStop) (data.tripsByStop.get(stopId) || []).forEach((trip) => relevantTrips.add(trip))
    else data.trips.forEach((trip) => {
      if (trip.stopTimes.some((entry) => entry.stop.id === stopId)) relevantTrips.add(trip)
    })
  })
  const byStop = new Map()
  const targetDayStart = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
  )
  for (const offset of [-1, 0]) {
    const date = serviceDate(targetDate, offset)
    const activeServices = getActiveServiceIndexes(data, date)
    for (const trip of relevantTrips) {
      if (!activeServices.has(trip.serviceIndex)) continue
      if (offset < 0 && trip.stopTimes.at(-1).arrivalSeconds < 86_400) continue
      const stopTimes = trip.stopTimes.map((stopTime) => ({
        ...stopTime,
        arrivalAt: dateAtServiceTime(date, stopTime.arrivalSeconds),
        departureAt: dateAtServiceTime(date, stopTime.departureSeconds),
      }))
      if (offset < 0 && stopTimes.at(-1).arrivalAt < targetDayStart) continue
      const instance = { ...trip, serviceDate: date, stopTimes }
      stopTimes.forEach((entry, index) => {
        const entries = byStop.get(entry.stop.id) || []
        entries.push({ instance, index })
        byStop.set(entry.stop.id, entries)
      })
    }
  }

  byStop.forEach((entries) => entries.sort((a, b) =>
    a.instance.stopTimes[a.index].departureAt - b.instance.stopTimes[b.index].departureAt,
  ))
  const result = { byStop }
  dateCache.set(cacheKey, result)
  if (dateCache.size > 3) dateCache.delete(dateCache.keys().next().value)
  return result
}

function findBoardingIndex(trip, stopId) {
  return trip.stopTimes.findIndex((entry) =>
    entry.stop.id === stopId && entry.pickupType !== '1',
  )
}

function findGroupAlightingIndex(trip, stopIds, afterIndex) {
  for (let index = afterIndex + 1; index < trip.stopTimes.length; index += 1) {
    const entry = trip.stopTimes[index]
    if (stopIds.has(entry.stop.id) && entry.dropOffType !== '1') return index
  }
  return -1
}

function makeLeg(instance, fromIndex, toIndex, vehicles, now) {
  const boarding = instance.stopTimes[fromIndex]
  const alighting = instance.stopTimes[toIndex]
  const path = instance.stopTimes.slice(fromIndex, toIndex + 1)
  const liveMatch = findLiveVehicle(instance, boarding, vehicles, now)
  const shapePoints = instance.shape?.points || []
  const minShapeDistance = boarding.shapeDistance
  const maxShapeDistance = alighting.shapeDistance
  const segmentShape = Number.isFinite(minShapeDistance) && Number.isFinite(maxShapeDistance)
    ? shapePoints.filter((point) =>
      point.distance >= minShapeDistance && point.distance <= maxShapeDistance,
    )
    : []
  const routeShapePoints = [
    { lat: boarding.stop.coordinates.lat, lon: boarding.stop.coordinates.lon },
    ...segmentShape,
    { lat: alighting.stop.coordinates.lat, lon: alighting.stop.coordinates.lon },
  ]

  return {
    tripId: instance.id,
    _instance: instance,
    _boardingIndex: fromIndex,
    routeId: instance.route.id,
    line: instance.route.number,
    routeName: instance.route.name,
    transportType: instance.route.type,
    destination: path.at(-1).headsign || instance.headsign || instance.route.destination,
    headsign: instance.headsign || instance.route.destination,
    direction: instance.direction,
    wheelchairAccessible: instance.wheelchairAccessible,
    minutesPerStop: Math.max(1, (alighting.arrivalAt - boarding.departureAt) / 60_000 / (toIndex - fromIndex)),
    pathStops: path.map((entry) => entry.stop),
    stopTimes: path,
    shape: instance.shape,
    shapePoints: routeShapePoints,
    stopCount: toIndex - fromIndex,
    durationMinutes: Math.max(1, Math.ceil((alighting.arrivalAt - boarding.departureAt) / 60_000)),
    isLive: Boolean(liveMatch),
    isSimulated: Boolean(liveMatch?.vehicle.isSimulated),
    vehicle: liveMatch?.vehicle || null,
    liveDistance: liveMatch?.distanceToStop ?? null,
    estimatedDelayMinutes: liveMatch?.delayMinutes ?? null,
    estimatedDepartureAt: liveMatch?.estimatedDepartureAt || boarding.departureAt,
    departsAt: boarding.departureAt,
    arrivalAt: alighting.arrivalAt,
  }
}

function makeTrip(legs, from, to, destinationWalk = null) {
  const departsAt = legs[0].departsAt
  const arrivesAt = new Date(legs.at(-1).arrivalAt.getTime() + (destinationWalk?.minutes || 0) * 60_000)
  const stopCount = legs.reduce((total, leg) => total + leg.stopCount, 0)
  const transferMinutes = legs.length > 1
    ? Math.max(TRANSFER_MINUTES, Math.ceil((legs[1].departsAt - legs[0].arrivalAt) / 60_000))
    : 0
  const journeySteps = legs.flatMap((leg, legIndex) => {
    const steps = leg.stopTimes.map((entry, stopIndex) => ({
      stop: entry.stop,
      line: leg.line,
      transportType: leg.transportType,
      timeAt: entry.arrivalAt,
      departureAt: entry.departureAt,
      transferFromStop: legIndex > 0 && stopIndex === 0 ? leg.transferFromStop : null,
      transferWalkMinutes: legIndex > 0 && stopIndex === 0 ? leg.transferWalkMinutes : 0,
      transferTo: legIndex < legs.length - 1 && stopIndex === leg.stopTimes.length - 1
        ? legs[legIndex + 1].line
        : null,
    }))
    const sameTransferStop = legIndex > 0 &&
      legs[legIndex - 1].pathStops.at(-1).id === leg.pathStops[0].id
    return legIndex && sameTransferStop ? steps.slice(1) : steps
  })

  return {
    id: `${legs.map((leg) => `${leg.tripId}-${leg.pathStops[0].id}-${leg.pathStops.at(-1).id}`).join('/')}${destinationWalk ? `-walk-${to.id}` : ''}`,
    from,
    to,
    legs,
    stopCount,
    durationMinutes: Math.max(1, Math.ceil((arrivesAt - departsAt) / 60_000)),
    transferMinutes,
    destinationWalk,
    departsAt,
    arrivesAt,
    pathStops: legs.flatMap((leg, index) => {
      const sameTransferStop = index > 0 &&
        legs[index - 1].pathStops.at(-1).id === leg.pathStops[0].id
      return index && sameTransferStop ? leg.pathStops.slice(1) : leg.pathStops
    }),
    journeySteps,
    isLive: legs[0].isLive,
    vehicle: legs[0].vehicle,
    estimatedDelayMinutes: legs[0].estimatedDelayMinutes,
    dataSource: 'GTFS',
  }
}

function isWithinWindow(date, requested, searchMode) {
  const difference = (date.getTime() - requested.getTime()) / 3_600_000
  return searchMode === 'arrive'
    ? difference <= 0 && difference >= -MAX_SEARCH_HOURS
    : difference >= 0 && difference <= MAX_SEARCH_HOURS
}

function firstDepartureIndex(entries, targetTime) {
  let low = 0
  let high = entries.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (entries[middle].departureAt.getTime() < targetTime) low = middle + 1
    else high = middle
  }
  return low
}

function distanceMeters(a, b) {
  const latitude = (a.lat + b.lat) * Math.PI / 360
  const x = (b.lon - a.lon) * Math.cos(latitude) * 111_320
  const y = (b.lat - a.lat) * 110_540
  return Math.hypot(x, y)
}

function bearingDegrees(from, to) {
  const lat1 = from.lat * Math.PI / 180
  const lat2 = to.lat * Math.PI / 180
  const deltaLon = (to.lon - from.lon) * Math.PI / 180
  const y = Math.sin(deltaLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

function angleDifference(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180)
}

function projectOnShape(location, shapePoints) {
  let best = null
  let accumulatedDistance = 0

  for (let index = 1; index < shapePoints.length; index += 1) {
    const start = shapePoints[index - 1]
    const end = shapePoints[index]
    const segmentMeters = distanceMeters(start, end)
    if (!segmentMeters) continue
    const latitudeScale = Math.cos(((start.lat + end.lat) / 2) * Math.PI / 180)
    const dx = (end.lon - start.lon) * latitudeScale * 111_320
    const dy = (end.lat - start.lat) * 110_540
    const px = (location.lon - start.lon) * latitudeScale * 111_320
    const py = (location.lat - start.lat) * 110_540
    const ratio = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)))
    const distance = Math.hypot(px - dx * ratio, py - dy * ratio)
    const startDistance = Number.isFinite(start.distance) ? start.distance : accumulatedDistance
    const endDistance = Number.isFinite(end.distance) ? end.distance : accumulatedDistance + segmentMeters
    const progress = startDistance + (endDistance - startDistance) * ratio

    if (!best || distance < best.distance) {
      best = {
        distance,
        progress,
        bearing: bearingDegrees(start, end),
      }
    }
    accumulatedDistance += segmentMeters
  }

  return best
}

function findLiveVehicle(instance, boarding, vehicles, now) {
  if (!vehicles.length || !instance.shape?.points?.length || !Number.isFinite(boarding.shapeDistance)) return null

  const candidates = vehicles
    .filter((vehicle) =>
      !vehicle.isSimulated &&
      vehicle.line.toLowerCase() === instance.route.number.toLowerCase() &&
      vehicle.transportType === instance.route.type,
    )
    .map((vehicle) => {
      const projection = projectOnShape({ lat: vehicle.lat, lon: vehicle.lon }, instance.shape.points)
      if (!projection || projection.distance > 180) return null
      if (angleDifference(projection.bearing, Number(vehicle.heading) || 0) > 65) return null
      const distanceToStop = boarding.shapeDistance - projection.progress
      if (distanceToStop < 0 || distanceToStop > MAX_LIVE_APPROACH_METERS) return null

      const speed = Number(vehicle.speed) > 3 ? Number(vehicle.speed) : 18
      const etaMinutes = Math.max(0, distanceToStop / 1000 / speed * 60)
      const estimatedDepartureAt = new Date(now.getTime() + etaMinutes * 60_000)
      return {
        vehicle,
        distance: projection.distance,
        distanceToStop,
        etaMinutes,
        estimatedDepartureAt,
        delayMinutes: Math.round((estimatedDepartureAt - boarding.departureAt) / 60_000),
      }
    })
    .filter(Boolean)

  return candidates.sort((a, b) =>
    a.distance - b.distance || a.etaMinutes - b.etaMinutes,
  )[0] || null
}

function createDirectTrips(instancesByStop, fromStops, destinationIds, walkingOptions, requestedAt, searchMode) {
  const results = []
  const visited = new Set()
  for (const fromStop of fromStops) {
    for (const { instance } of instancesByStop.get(fromStop.id) || []) {
      const key = `${instance.id}:${instance.serviceDate.getTime()}:${fromStop.id}`
      if (visited.has(key)) continue
      visited.add(key)
      const fromIndex = findBoardingIndex(instance, fromStop.id)
      if (fromIndex < 0) continue
      const exactIndex = findGroupAlightingIndex(instance, destinationIds, fromIndex)
      let bestWalk = null
      for (let index = fromIndex + 1; index < instance.stopTimes.length; index += 1) {
        const entry = instance.stopTimes[index]
        const walk = walkingOptions.get(entry.stop.id)
        if (!walk || entry.dropOffType === '1') continue
        const arrival = entry.arrivalAt.getTime() + walk.minutes * 60_000
        if (!bestWalk || arrival < bestWalk.arrival || (arrival === bestWalk.arrival && walk.minutes < bestWalk.walk.minutes)) {
          bestWalk = { index, walk, arrival }
        }
      }

      const options = []
      if (exactIndex >= 0) options.push({ index: exactIndex, walk: null })
      if (bestWalk && (exactIndex < 0 || bestWalk.arrival < instance.stopTimes[exactIndex].arrivalAt.getTime())) {
        options.push(bestWalk)
      }
      for (const { index, walk } of options) {
        const leg = makeLeg(instance, fromIndex, index, [], requestedAt)
        const destinationWalk = walk ? { ...walk, from: instance.stopTimes[index].stop } : null
        const trip = makeTrip([leg], fromStop, walk?.to || instance.stopTimes[index].stop, destinationWalk)
        const relevantTime = searchMode === 'arrive' ? trip.arrivesAt : trip.departsAt
        if (isWithinWindow(relevantTime, requestedAt, searchMode)) results.push(trip)
      }
    }
  }
  return results
}

function getDestinationWalkingOptions(data, toStops) {
  const destinationIds = new Set(toStops.map((stop) => stop.id))
  const options = new Map()
  for (const stop of data.stops || []) {
    if (destinationIds.has(stop.id) || !Number.isFinite(stop.coordinates.lat) || !Number.isFinite(stop.coordinates.lon)) continue
    let nearest = null
    for (const destination of toStops) {
      if (!Number.isFinite(destination.coordinates.lat) || !Number.isFinite(destination.coordinates.lon)) continue
      const distance = distanceBetween(stop.coordinates, destination.coordinates) * WALK_DISTANCE_FACTOR
      if (!nearest || distance < nearest.distanceMeters) nearest = { to: destination, distanceMeters: distance }
    }
    if (!nearest || nearest.distanceMeters > MAX_DESTINATION_WALK_METERS) continue
    options.set(stop.id, {
      ...nearest,
      distanceMeters: Math.round(nearest.distanceMeters),
      minutes: Math.max(1, Math.ceil(nearest.distanceMeters / WALK_METERS_PER_MINUTE)),
    })
  }
  return options
}

function makeWalkingTrip(from, walk, requestedAt, searchMode) {
  const departsAt = searchMode === 'arrive'
    ? new Date(requestedAt.getTime() - walk.minutes * 60_000)
    : requestedAt
  const arrivesAt = new Date(departsAt.getTime() + walk.minutes * 60_000)
  return {
    id: `walk-${from.id}-${walk.to.id}`,
    from,
    to: walk.to,
    legs: [],
    stopCount: 0,
    durationMinutes: walk.minutes,
    transferMinutes: 0,
    destinationWalk: { ...walk, from },
    isWalkingOnly: true,
    departsAt,
    arrivesAt,
    pathStops: [from],
    journeySteps: [{ stop: from, timeAt: departsAt }],
    isLive: false,
    vehicle: null,
    estimatedDelayMinutes: null,
    dataSource: 'GTFS',
  }
}

function createTransferTrips(instancesByStop, fromStops, destinationIds, requestedAt, searchMode, count) {
  const departuresByStop = new Map()
  const secondVisited = new Set()
  for (const destinationId of destinationIds) {
    for (const { instance, index: destinationIndex } of instancesByStop.get(destinationId) || []) {
      if (destinationIndex < 1 || instance.stopTimes[destinationIndex].dropOffType === '1') continue
      for (let index = 0; index < destinationIndex; index += 1) {
        const entry = instance.stopTimes[index]
        if (entry.pickupType === '1') continue
        const key = `${instance.id}:${instance.serviceDate.getTime()}:${index}`
        if (secondVisited.has(key)) continue
        secondVisited.add(key)
        const entries = departuresByStop.get(entry.stop.id) || []
        entries.push({ instance, index, departureAt: entry.departureAt })
        departuresByStop.set(entry.stop.id, entries)
      }
    }
  }
  departuresByStop.forEach((entries) => entries.sort((a, b) => a.departureAt - b.departureAt))

  const firstVisited = new Set()
  const firstTripOptions = fromStops.flatMap((fromStop) =>
    (instancesByStop.get(fromStop.id) || []).flatMap(({ instance }) => {
      const key = `${instance.id}:${instance.serviceDate.getTime()}:${fromStop.id}`
      if (firstVisited.has(key)) return []
      firstVisited.add(key)
      const fromIndex = findBoardingIndex(instance, fromStop.id)
      if (fromIndex < 0) return []
      const departureAt = instance.stopTimes[fromIndex].departureAt
      return isWithinWindow(departureAt, requestedAt, searchMode)
        ? [{ instance, fromIndex, departureAt, fromStop }]
        : []
    }))
  firstTripOptions.sort((a, b) => searchMode === 'arrive'
    ? b.departureAt - a.departureAt
    : a.departureAt - b.departureAt)

  const results = []
  const seen = new Set()
  const maxResults = Math.max(100, count * 50)
  for (const { instance: firstInstance, fromIndex, fromStop } of firstTripOptions) {

    for (let transferIndex = fromIndex + 1; transferIndex < firstInstance.stopTimes.length; transferIndex += 1) {
      const transferEntry = firstInstance.stopTimes[transferIndex]
      if (transferEntry.dropOffType === '1') continue
      const transferOptions = transferEntry.stop.transferOptions ||
        [{ stop: transferEntry.stop, distance: 0, walkMinutes: 0 }]

      for (const transferOption of transferOptions) {
        if (transferOption.stop.id === fromStop.id) continue
        const secondOptions = departuresByStop.get(transferOption.stop.id) || []
        const walkMinutes = transferOption.distance ? transferOption.walkMinutes : 0
        const bufferMinutes = transferOption.distance ? 3 : TRANSFER_MINUTES
        const earliestTransferTime = transferEntry.arrivalAt.getTime() +
          (walkMinutes + bufferMinutes) * 60_000
        const startOptionIndex = firstDepartureIndex(secondOptions, earliestTransferTime)

        for (let optionIndex = startOptionIndex; optionIndex < secondOptions.length; optionIndex += 1) {
          const option = secondOptions[optionIndex]
          if (option.instance.id === firstInstance.id) continue
          if (option.instance.route.id === firstInstance.route.id) continue
          const destinationIndex = findGroupAlightingIndex(option.instance, destinationIds, option.index)
          if (destinationIndex < 0) continue
          const secondLeg = makeLeg(option.instance, option.index, destinationIndex, [], requestedAt)
          secondLeg.transferFromStop = transferEntry.stop
          secondLeg.transferWalkMinutes = walkMinutes
          const trip = makeTrip([
            makeLeg(firstInstance, fromIndex, transferIndex, [], requestedAt),
            secondLeg,
          ], fromStop, option.instance.stopTimes[destinationIndex].stop)
          if (!isWithinWindow(
            searchMode === 'arrive' ? trip.arrivesAt : trip.departsAt,
            requestedAt,
            searchMode,
          )) continue
          const key = `${trip.id}-${trip.departsAt.getTime()}`
          if (!seen.has(key)) {
            seen.add(key)
            results.push(trip)
          }
          break
        }
        if (results.length >= maxResults) return results
      }
    }
  }

  return results
}

export function planRoutes({
  fromStop,
  toStop,
  fromStops = fromStop ? [fromStop] : [],
  toStops = toStop ? [toStop] : [],
  data,
  vehicles = [],
  now = new Date(),
  departureAt = now,
  searchMode = 'depart',
  count = 5,
  includeWalkingOnly = true,
}) {
  if (!fromStops.length || !toStops.length || !data?.trips) return []
  const destinationIds = new Set(toStops.map((stop) => stop.id))
  const originStops = fromStops.filter((stop) => !destinationIds.has(stop.id))
  if (!originStops.length) return []
  const requestedAt = departureAt instanceof Date ? departureAt : new Date(departureAt)
  if (!Number.isFinite(requestedAt.getTime()) || !['depart', 'arrive'].includes(searchMode)) return []

  const { byStop: instancesByStop } = getTripInstances(data, requestedAt, [
    ...originStops.map((stop) => stop.id),
    ...destinationIds,
  ])
  const walkingOptions = getDestinationWalkingOptions(data, toStops)
  const direct = createDirectTrips(instancesByStop, originStops, destinationIds, walkingOptions, requestedAt, searchMode)
  const walks = includeWalkingOnly
    ? originStops.flatMap((stop) => {
      const walk = walkingOptions.get(stop.id)
      return walk ? [makeWalkingTrip(stop, walk, requestedAt, searchMode)] : []
    })
    : []
  const transfers = createTransferTrips(
    instancesByStop,
    originStops,
    destinationIds,
    requestedAt,
    searchMode,
    count,
  )
  const unique = new Map()
  for (const trip of [...walks, ...direct, ...transfers]) {
    const key = `${trip.id}-${trip.departsAt.getTime()}`
    if (!unique.has(key)) unique.set(key, trip)
  }

  const comfortMinutes = (trip) => Math.max(0, trip.legs.length - 1) * 5 + (trip.destinationWalk?.minutes || 0) * 0.25
  const adjustedArrival = (trip) => trip.arrivesAt.getTime() + comfortMinutes(trip) * 60_000
  const orderedCandidates = [...unique.values()].sort((a, b) =>
    b.departsAt - a.departsAt || adjustedArrival(a) - adjustedArrival(b),
  )
  const candidates = []
  let bestArrival = Infinity
  let bestDeparture = -Infinity
  for (const trip of orderedCandidates) {
    const departure = trip.departsAt.getTime()
    const arrival = adjustedArrival(trip)
    if (arrival > bestArrival || (arrival === bestArrival && departure < bestDeparture)) continue
    candidates.push(trip)
    if (arrival < bestArrival) {
      bestArrival = arrival
      bestDeparture = departure
    }
  }
  candidates.sort((a, b) => searchMode === 'arrive'
    ? b.arrivesAt - a.arrivesAt || (b.departsAt - a.departsAt) + (comfortMinutes(a) - comfortMinutes(b)) * 60_000
    : a.departsAt - b.departsAt || (a.arrivesAt - b.arrivesAt) + (comfortMinutes(a) - comfortMinutes(b)) * 60_000)

  const results = []
  const seenSlots = new Set()
  const alternatives = []
  for (const trip of candidates) {
    const slot = searchMode === 'arrive' ? trip.arrivesAt.getTime() : trip.departsAt.getTime()
    if (seenSlots.has(slot)) {
      alternatives.push(trip)
      continue
    }
    seenSlots.add(slot)
    results.push(trip)
    if (results.length >= Math.max(1, Math.min(10, count))) break
  }
  if (results.length < Math.max(1, Math.min(10, count))) {
    results.push(...alternatives.slice(0, Math.max(1, Math.min(10, count)) - results.length))
    results.sort((a, b) => searchMode === 'arrive'
      ? b.arrivesAt - a.arrivesAt || a.durationMinutes - b.durationMinutes
      : a.departsAt - b.departsAt || a.durationMinutes - b.durationMinutes)
  }

  results.forEach((trip) => {
    trip.legs.forEach((leg) => {
      const liveMatch = findLiveVehicle(
        leg._instance,
        leg._instance.stopTimes[leg._boardingIndex],
        vehicles,
        now,
      )
      leg.isLive = Boolean(liveMatch)
      leg.isSimulated = Boolean(liveMatch?.vehicle.isSimulated)
      leg.vehicle = liveMatch?.vehicle || null
      leg.liveDistance = liveMatch?.distanceToStop ?? null
      leg.estimatedDelayMinutes = liveMatch?.delayMinutes ?? null
      leg.estimatedDepartureAt = liveMatch?.estimatedDepartureAt || leg.departsAt
      delete leg._instance
      delete leg._boardingIndex
    })
    if (trip.legs.length) {
      trip.isLive = trip.legs[0].isLive
      trip.vehicle = trip.legs[0].vehicle
      trip.estimatedDelayMinutes = trip.legs[0].estimatedDelayMinutes
    }
  })

  return results
}

export function getDeparturesAtStop(data, stop, at = new Date(), vehicles = [], count = 12) {
  if (!data?.trips || !stop) return []
  const now = at instanceof Date ? at : new Date(at)
  const { byStop } = getTripInstances(data, now, [stop.id])
  const upcoming = []
  const seenRoutes = new Set()

  for (const { instance, index } of byStop.get(stop.id) || []) {
    if (instance.stopTimes[index].pickupType === '1') continue
    const entry = instance.stopTimes[index]
    if (entry.departureAt < now || !instance.stopTimes[index + 1]) continue
    const key = `${instance.route.number}-${entry.departureAt.getTime()}`
    if (seenRoutes.has(key)) continue
    seenRoutes.add(key)
    const nextStop = instance.stopTimes[index + 1].stop
    upcoming.push({
      id: `${instance.id}-${stop.id}-${entry.departureSeconds}`,
      line: instance.route.number,
      transportType: instance.route.type,
      destination: entry.headsign || instance.headsign || instance.route.destination,
      minutes: Math.max(0, Math.ceil((entry.departureAt - now) / 60_000)),
      isLive: false,
      isSimulated: false,
      distance: null,
      vehicleId: null,
      scheduledAt: entry.departureAt,
      nextStop,
      estimatedDelayMinutes: null,
      _instance: instance,
      _index: index,
    })
    if (upcoming.length >= count) break
  }

  return upcoming.map(({ _instance, _index, ...departure }) => {
    const liveMatch = findLiveVehicle(_instance, _instance.stopTimes[_index], vehicles, now)
    return {
      ...departure,
      isLive: Boolean(liveMatch),
      isSimulated: Boolean(liveMatch?.vehicle.isSimulated),
      distance: liveMatch?.distanceToStop ?? null,
      vehicleId: liveMatch?.vehicle.vehicleId || null,
      estimatedDelayMinutes: liveMatch?.delayMinutes ?? null,
    }
  })
}
