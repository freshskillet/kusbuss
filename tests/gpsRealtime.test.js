import test from 'node:test'
import assert from 'node:assert/strict'
import { parseGpsText } from '../src/services/transportService.js'
import { getDeparturesAtStop, planRoutes } from '../src/services/routePlanner.js'
import { countyRealtimeUrl } from '../src/utils/countyRealtime.js'

test('parses Tallinn numeric GPS feed and preserves textual CSV support', () => {
  const vehicles = parseGpsText([
    '3,T6,24694200,59454670,,103,96,Z,33,Suur-Paala',
    '2,116,24750000,59430000,25,999,101',
    '1,85,24750000,59430000,12,,102',
    '7,91,24750000,59430000,20,90,103',
    'bus,2,24.75,59.43,18,0,104',
    '2,3,,59430000,20,90,105',
    '2,3,garbage,59430000,20,90,106',
  ].join('\n'))
  assert.equal(vehicles.length, 5)
  assert.deepEqual(vehicles[0], {
    transportType: 'tram', line: 'T6', lon: 24.6942, lat: 59.45467,
    speed: 0, heading: 103, vehicleId: '96', isSimulated: false,
  })
  assert.equal(vehicles[1].heading, null)
  assert.equal(vehicles[2].transportType, 'trolley')
  assert.equal(vehicles[2].heading, null)
  assert.equal(vehicles[3].transportType, 'bus')
  assert.equal(vehicles[4].lon, 24.75)
})

test('live matches require a known direction and a nearby scheduled departure', () => {
  const origin = { id: 'origin', name: 'Origin', coordinates: { lat: 59.31, lon: 24.75 } }
  const destination = { id: 'destination', name: 'Destination', coordinates: { lat: 59.32, lon: 24.75 } }
  const route = { id: 'city', number: '2', type: 'bus', name: 'Destination', destination: 'Destination' }
  const shape = { points: [
    { lat: 59.30, lon: 24.75, distance: 0 },
    { lat: 59.31, lon: 24.75, distance: 1112 },
    { lat: 59.32, lon: 24.75, distance: 2224 },
  ] }
  const trip = (id, departureSeconds) => ({
    id, route, serviceIndex: 0, shape,
    stopTimes: [
      { stop: origin, arrivalSeconds: departureSeconds, departureSeconds, shapeDistance: 1112, pickupType: '0' },
      { stop: destination, arrivalSeconds: departureSeconds + 600, departureSeconds: departureSeconds + 600, shapeDistance: 2224, dropOffType: '0' },
    ],
  })
  const data = {
    stops: [origin, destination], trips: [trip('near', 36240), trip('next', 36360), trip('later', 39600)],
    services: [{ start: '20260101', end: '20261231', weekdays: [true, true, true, true, true, true, true] }],
    exceptions: [],
  }
  const now = new Date(2026, 10, 24, 10, 0)
  const vehicle = { line: '2', transportType: 'bus', vehicleId: '1', lat: 59.30, lon: 24.75, heading: 0, speed: 18 }
  const departures = getDeparturesAtStop(data, origin, now, [vehicle])
  assert.equal(departures.find((entry) => entry.id.startsWith('near-')).isLive, true)
  assert.equal(departures.find((entry) => entry.id.startsWith('near-')).minutes, 4)
  assert.equal(departures.find((entry) => entry.id.startsWith('next-')).isLive, false)
  assert.equal(departures.find((entry) => entry.id.startsWith('later-')).isLive, false)
  const slower = getDeparturesAtStop(data, origin, now, [{ ...vehicle, speed: 9 }])
  assert.equal(slower.find((entry) => entry.id.startsWith('next-')).minutes, 8)
  assert.equal(slower.find((entry) => entry.id.startsWith('near-')).isLive, false)
  const planned = planRoutes({
    fromStops: [origin], toStops: [destination], data, vehicles: [vehicle],
    now, departureAt: now, count: 5,
  })
  assert.equal(planned.find((entry) => entry.legs[0]?.tripId === 'near').isLive, true)
  assert.equal(planned.find((entry) => entry.legs[0]?.tripId === 'next').isLive, false)
  for (const heading of [null, 180]) {
    assert.equal(getDeparturesAtStop(data, origin, now, [{ ...vehicle, heading }])[0].isLive, false)
  }

  const lateData = { ...data, trips: [trip('late', 35940), trip('later', 39600)] }
  const lateBoard = getDeparturesAtStop(lateData, origin, now, [vehicle])
  assert.equal(lateBoard[0].id.startsWith('late-'), true)
  assert.equal(lateBoard[0].isLive, true)
  assert.equal(lateBoard[0].minutes, 4)
  assert.equal(lateBoard[0].estimatedDelayMinutes, 5)
  assert.equal(getDeparturesAtStop(lateData, origin, now, [])[0].id.startsWith('later-'), true)
  assert.equal(getDeparturesAtStop(lateData, origin, now, [{ ...vehicle, heading: null }])[0].id.startsWith('later-'), true)
})

test('county map link uses the GTFS route identifier', () => {
  assert.equal(countyRealtimeUrl('county:harjumaa116'), 'https://web.peatus.ee/linjat/estonia:harjumaa116')
  assert.equal(countyRealtimeUrl('county:route/a'), 'https://web.peatus.ee/linjat/estonia:route%2Fa')
})

test('tracks the selected trip vehicle without switching to an earlier bus', () => {
  const origin = { id: 'origin', name: 'Origin', coordinates: { lat: 59.31, lon: 24.75 } }
  const destination = { id: 'destination', name: 'Destination', coordinates: { lat: 59.32, lon: 24.75 } }
  const route = { id: 'city', number: '2', type: 'bus', name: 'Destination', destination: 'Destination' }
  const shape = { points: [
    { lat: 59.28, lon: 24.75, distance: 0 },
    { lat: 59.31, lon: 24.75, distance: 3336 },
    { lat: 59.32, lon: 24.75, distance: 4448 },
    { lat: 59.33, lon: 24.75, distance: 5560 },
  ] }
  const trip = (id, seconds) => ({
    id, route, direction: '0', serviceIndex: 0, shape,
    stopTimes: [
      { stop: origin, arrivalSeconds: seconds, departureSeconds: seconds, shapeDistance: 3336, pickupType: '0' },
      { stop: destination, arrivalSeconds: seconds + 600, departureSeconds: seconds + 600, shapeDistance: 4448, dropOffType: '0' },
    ],
  })
  const data = {
    stops: [origin, destination], trips: [trip('earlier', 36060), trip('selected', 36240)],
    services: [{ start: '20260101', end: '20261231', weekdays: [true, true, true, true, true, true, true] }],
    exceptions: [],
  }
  const now = new Date(2026, 10, 24, 10, 0)
  const earlier = { line: '2', transportType: 'bus', vehicleId: 'earlier', lat: 59.308, lon: 24.75, heading: 0, speed: 18 }
  const selected = { ...earlier, vehicleId: 'selected', lat: 59.299 }
  const search = (vehicles, trackedVehicles = new Map(), currentTime = now) => planRoutes({
    fromStops: [origin], toStops: [destination], data, vehicles,
    now: currentTime, departureAt: now, count: 5, trackedVehicles,
  })
  const initial = search([earlier, selected]).find((item) => item.legs[0]?.tripId === 'selected')
  assert.equal(initial.legs[0].vehicle.vehicleId, 'selected')
  const pinned = new Map([[initial.legs[0].trackingKey, selected]])
  const moved = { ...selected, lat: 59.302 }
  const refreshed = search([earlier, moved], pinned, new Date(now.getTime() + 60_000))
  assert.equal(refreshed.find((item) => item.legs[0]?.tripId === 'selected').legs[0].vehicle.vehicleId, 'selected')
  assert.equal(search([selected], pinned).find((item) => item.legs[0]?.tripId === 'earlier').isLive, false)
  assert.equal(search([earlier], pinned).find((item) => item.legs[0]?.tripId === 'selected').isLive, false)
  assert.equal(search([earlier, { ...moved, isSimulated: true }], pinned).find((item) => item.legs[0]?.tripId === 'selected').isLive, false)
  const onboard = search([earlier, { ...selected, lat: 59.315 }], pinned).find((item) => item.legs[0]?.tripId === 'selected').legs[0]
  assert.equal(onboard.vehicle.vehicleId, 'selected')
  assert.equal(onboard.estimatedDepartureAt, null)
  assert.equal(onboard.estimatedDelayMinutes, null)
  assert.equal(search([earlier, { ...selected, lat: 59.321 }], pinned).find((item) => item.legs[0]?.tripId === 'selected').isLive, false)
  assert.equal(search([earlier, { ...selected, heading: 180 }], pinned).find((item) => item.legs[0]?.tripId === 'selected').isLive, false)
})

test('does not guess between equally plausible vehicles or neighbouring trips', () => {
  const origin = { id: 'origin', name: 'Origin', coordinates: { lat: 59.31, lon: 24.75 } }
  const destination = { id: 'destination', name: 'Destination', coordinates: { lat: 59.32, lon: 24.75 } }
  const route = { id: 'city', number: '2', type: 'bus', name: 'Destination', destination: 'Destination' }
  const shape = { points: [
    { lat: 59.30, lon: 24.75, distance: 0 }, { lat: 59.31, lon: 24.75, distance: 1112 },
    { lat: 59.32, lon: 24.75, distance: 2224 },
  ] }
  const trip = (id, seconds) => ({
    id, route, direction: '0', serviceIndex: 0, shape,
    stopTimes: [
      { stop: origin, arrivalSeconds: seconds, departureSeconds: seconds, shapeDistance: 1112, pickupType: '0' },
      { stop: destination, arrivalSeconds: seconds + 600, departureSeconds: seconds + 600, shapeDistance: 2224, dropOffType: '0' },
    ],
  })
  const data = {
    stops: [origin, destination], trips: [trip('selected', 36240)],
    services: [{ start: '20260101', end: '20261231', weekdays: [true, true, true, true, true, true, true] }],
    exceptions: [],
  }
  const now = new Date(2026, 10, 24, 10, 0)
  const vehicle = { line: '2', transportType: 'bus', vehicleId: 'a', lat: 59.30, lon: 24.75, heading: 0, speed: 18 }
  assert.equal(getDeparturesAtStop(data, origin, now, [vehicle, { ...vehicle, vehicleId: 'b' }])[0].isLive, false)
  const competing = { ...data, trips: [trip('earlier', 36180), trip('selected', 36300)] }
  assert.equal(getDeparturesAtStop(competing, origin, now, [vehicle]).every((item) => !item.isLive), true)
})

test('finds an already departed bus by its progress and scheduled position', () => {
  const origin = { id: 'origin', name: 'Origin', coordinates: { lat: 59.31, lon: 24.75 } }
  const destination = { id: 'destination', name: 'Destination', coordinates: { lat: 59.32, lon: 24.75 } }
  const route = { id: 'city', number: '36', type: 'bus', name: 'Destination', destination: 'Destination' }
  const shape = { points: [
    { lat: 59.31, lon: 24.75, distance: 0 },
    { lat: 59.32, lon: 24.75, distance: 1112 },
  ] }
  const trip = (id, seconds) => ({
    id, route, direction: '0', serviceIndex: 0, shape,
    stopTimes: [
      { stop: origin, arrivalSeconds: seconds, departureSeconds: seconds, shapeDistance: 0, pickupType: '0' },
      { stop: destination, arrivalSeconds: seconds + 600, departureSeconds: seconds + 600, shapeDistance: 1112, dropOffType: '0' },
    ],
  })
  const data = {
    stops: [origin, destination], trips: [trip('earlier', 35700), trip('selected', 36000)],
    services: [{ start: '20260101', end: '20261231', weekdays: [true, true, true, true, true, true, true] }],
    exceptions: [],
  }
  const now = new Date(2026, 10, 24, 10, 5)
  const selected = { line: '36', transportType: 'bus', vehicleId: 'selected', lat: 59.315, lon: 24.75, heading: 0, speed: 18 }
  const earlier = { ...selected, vehicleId: 'earlier', lat: 59.319 }
  const find = (input, clock = now, source = data) => planRoutes({
    fromStops: [origin], toStops: [destination], data: source, vehicles: input,
    now: clock, departureAt: new Date(2026, 10, 24, 9, 54), count: 5,
  }).find((item) => item.legs[0]?.tripId === 'selected').legs[0]
  const leg = find([earlier, selected])
  assert.equal(leg.vehicle.vehicleId, 'selected')
  assert.equal(leg.estimatedDepartureAt, null)
  assert.equal(leg.estimatedDelayMinutes, null)
  assert.equal(find([earlier]).isLive, false)
  assert.equal(find([{ ...selected, heading: 180 }]).isLive, false)
  assert.equal(find([{ ...selected, isSimulated: true }]).isLive, false)
  assert.equal(find([selected], new Date(2026, 10, 24, 11, 5)).isLive, false)
  assert.equal(find([selected, { ...selected, vehicleId: 'ambiguous' }]).isLive, false)
  const closeTrips = { ...data, trips: [trip('earlier', 35970), trip('selected', 36000)] }
  assert.equal(find([selected], now, closeTrips).isLive, false)
  const differentShapes = {
    ...data,
    trips: [{ ...trip('earlier', 35970), shape: { points: [...shape.points] } }, trip('selected', 36000)],
  }
  assert.equal(find([selected], now, differentShapes).isLive, false)
})
