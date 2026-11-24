import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptItineraries } from '../src/services/digitransitAdapter.js'
import { matchItineraryVehicles } from '../src/services/routePlanner.js'
import { journeyTimeline } from '../src/utils/journeyTimeline.js'

function place(name, lat, id) {
  return { name, lat, lon: 24.75, stop: id ? { gtfsId: id, name, lat, lon: 24.75 } : null }
}

function leg({ start, end, from, to, transit = false, line = '2', routeName = 'A - B' }) {
  return {
    mode: transit ? 'BUS' : 'WALK', transitLeg: transit,
    start: { scheduledTime: start.toISOString() }, end: { scheduledTime: end.toISOString() },
    duration: (end - start) / 1000, distance: 300, from, to,
    id: 'api-leg', serviceDate: '2026-11-25',
    route: transit ? { gtfsId: 'Viro:2', shortName: line, longName: routeName } : null,
    trip: transit ? { gtfsId: 'Viro:trip-2' } : null,
  }
}

test('preserves actual walking and transit legs, timings, county styling and timeline', () => {
  const start = new Date('2026-11-25T10:00:00Z')
  const after = (minutes) => new Date(start.getTime() + minutes * 60_000)
  const origin = place('Origin', 59.30)
  const board = place('Kiili', 59.31, 'Viro:1')
  const exit = place('Viru', 59.32, 'Viro:2')
  const destination = place('Destination', 59.33)
  const itinerary = {
    start: start.toISOString(), end: after(23).toISOString(),
    legs: [
      leg({ start, end: after(3), from: origin, to: board }),
      leg({ start: after(5), end: after(20), from: board, to: exit, transit: true, line: '116', routeName: 'Tallinn - Kiili' }),
      leg({ start: after(20), end: after(23), from: exit, to: destination }),
    ],
  }
  itinerary.legs[1].stopCalls = [{
    stopLocation: { __typename: 'Stop', gtfsId: 'Viro:middle', name: 'Luige', lat: 59.315, lon: 24.75 },
    schedule: { time: { __typename: 'ArrivalDepartureTime', arrival: after(10).toISOString(), departure: after(10).toISOString() } },
  }]
  const [trip] = adaptItineraries([itinerary], {
    from: { name: 'Minu asukoht' }, to: { name: 'Sihtkoht' },
    routes: [{ id: 'county:116', number: '116', name: 'Tallinn - Kiili', type: 'county' }],
  })
  assert.equal(trip.durationMinutes, 23)
  assert.equal(trip.walkMinutes, 6)
  assert.equal(trip.legs[0].transportType, 'county')
  assert.equal(trip.legs[0].routeId, 'county:116')
  assert.equal(trip.legs[0].stopTimes[1].stop.name, 'Luige')
  assert.deepEqual(trip.routeLegs.map((item) => item.type), ['walk', 'transit', 'walk'])
  const timeline = journeyTimeline(trip)
  assert.equal(timeline[0].stop.name, 'Minu asukoht')
  assert.equal(timeline.at(-1).stop.name, 'Sihtkoht')
  assert.ok(timeline.some((row) => row.type === 'wait' && row.minutes === 2))
  assert.equal(timeline.filter((row) => row.type === 'walk').length, 2)
  assert.equal(journeyTimeline(trip, null, new Set([0])).some((row) => row.stop?.name === 'Luige'), true)
})

test('walking-only itinerary remains usable and malformed times are rejected', () => {
  const start = new Date('2026-11-25T10:00:00Z')
  const end = new Date(start.getTime() + 300_000)
  const raw = { start: start.toISOString(), end: end.toISOString(), legs: [leg({ start, end, from: place('A', 59.31), to: place('B', 59.32) })] }
  const [trip] = adaptItineraries([raw], { from: { name: 'A' }, to: { name: 'B' } })
  assert.equal(trip.isWalkingOnly, true)
  assert.equal(journeyTimeline(trip).at(-1).stop.name, 'B')
  assert.throws(() => adaptItineraries([{ ...raw, start: null }], { from: {}, to: {} }), /kellaaeg/)
})

test('matches only the corresponding local scheduled trip and retains its pinned vehicle', () => {
  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
  const departure = new Date(day.getTime() + (seconds + 240) * 1000)
  const arrival = new Date(departure.getTime() + 600_000)
  const board = { id: 'local-a', name: 'A', coordinates: { lat: 59.31, lon: 24.75 } }
  const exit = { id: 'local-b', name: 'B', coordinates: { lat: 59.32, lon: 24.75 } }
  const route = { id: 'city', number: '2', type: 'bus' }
  const shape = { points: [
    { lat: 59.28, lon: 24.75, distance: 0 },
    { lat: 59.31, lon: 24.75, distance: 3336 },
    { lat: 59.32, lon: 24.75, distance: 4448 },
  ] }
  const localTrip = (id, dep) => ({
    id, route, direction: '0', serviceIndex: 0, shape,
    stopTimes: [
      { stop: board, arrivalSeconds: dep, departureSeconds: dep, shapeDistance: 3336 },
      { stop: exit, arrivalSeconds: dep + 600, departureSeconds: dep + 600, shapeDistance: 4448 },
    ],
  })
  const data = {
    stops: [board, exit], trips: [localTrip('earlier', seconds + 60), localTrip('selected', seconds + 240)],
    services: [{ start: '20200101', end: '20991231', weekdays: [true, true, true, true, true, true, true] }],
    exceptions: [],
  }
  const api = {
    start: departure.toISOString(), end: arrival.toISOString(),
    legs: [leg({ start: departure, end: arrival, from: place('A', 59.31, 'api-a'), to: place('B', 59.32, 'api-b'), transit: true })],
  }
  const [trip] = adaptItineraries([api], { from: { name: 'A' }, to: { name: 'B' } })
  const selected = { line: '2', transportType: 'bus', vehicleId: 'selected', lat: 59.299, lon: 24.75, heading: 0, speed: 18 }
  const earlier = { ...selected, vehicleId: 'earlier', lat: 59.308 }
  const tracked = new Map([[trip.legs[0].trackingKey, selected]])
  const [result] = matchItineraryVehicles([trip], data, [earlier, selected], tracked, now)
  assert.equal(result.legs[0].vehicle?.vehicleId, 'selected')
  assert.equal(result.routeLegs[0].vehicle?.vehicleId, 'selected')
  const [missing] = matchItineraryVehicles([trip], data, [earlier], tracked, now)
  assert.equal(missing.legs[0].vehicle, null)
  data.trips.push(localTrip('duplicate', seconds + 240))
  const duplicateData = { ...data }
  const [ambiguous] = matchItineraryVehicles([trip], duplicateData, [selected], tracked, now)
  assert.equal(ambiguous.legs[0].vehicle, null)
})
