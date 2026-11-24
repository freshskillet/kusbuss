import test from 'node:test'
import assert from 'node:assert/strict'
import { groupStops } from '../src/utils/stopGroups.js'
import { planRoutes } from '../src/services/routePlanner.js'

function stop(id, name, lat, extra = {}) {
  return { id, name, area: 'Kesklinn', coordinates: { lat, lon: 24.75 }, ...extra }
}

test('groups nearby same-name stops and station platforms without joining distant namesakes', () => {
  const stops = [
    stop('1', 'Viru', 59.43),
    stop('2', 'Viru', 59.431),
    stop('3', 'Viru', 59.45),
    stop('4', 'Jaam (train station)', 59.44),
    stop('5', 'Jaam 1 (train station)', 59.4401, { parentStation: '4' }),
  ]
  const { groups, groupByStopId } = groupStops(stops)
  assert.equal(groupByStopId.get('1'), groupByStopId.get('2'))
  assert.notEqual(groupByStopId.get('1'), groupByStopId.get('3'))
  assert.equal(groupByStopId.get('4'), groupByStopId.get('5'))
  assert.equal(groupByStopId.get('4').name, 'Jaam')
  assert.equal(groups.length, 3)
})

test('searches all selected platforms and keeps actual boarding and alighting stops', () => {
  const originA = stop('a', 'Viru', 59.43)
  const originB = stop('b', 'Viru', 59.431)
  const destinationA = stop('c', 'Siht', 59.44)
  const destinationB = stop('d', 'Siht', 59.441)
  const middle = stop('m', 'Vahe', 59.435)
  for (const item of [originA, originB, destinationA, destinationB, middle]) {
    item.transferOptions = [{ stop: item, distance: 0, walkMinutes: 0 }]
  }
  const trip = (id, line, entries) => ({
    id,
    route: { id: line, number: line, type: 'bus', name: line, destination: 'Siht' },
    serviceIndex: 0,
    stopTimes: entries.map(([item, minute]) => ({
      stop: item, arrivalSeconds: minute * 60, departureSeconds: minute * 60,
      pickupType: '0', dropOffType: '0',
    })),
  })
  const trips = [
    trip('direct', '20', [[originB, 9 * 60 + 10], [destinationB, 9 * 60 + 30]]),
    trip('first', '1', [[originA, 9 * 60 + 5], [middle, 9 * 60 + 10]]),
    trip('second', '2', [[middle, 9 * 60 + 15], [destinationA, 9 * 60 + 20]]),
  ]
  const data = {
    trips,
    services: [{ start: '20260101', end: '20261231', weekdays: [1, 1, 1, 1, 1, 1, 1] }],
    exceptions: [],
  }
  const at = new Date(2026, 10, 24, 9, 0)
  const args = { fromStops: [originA, originB], toStops: [destinationA, destinationB], data, now: at, departureAt: at }
  const results = planRoutes(args)
  const direct = results.find((result) => result.legs.length === 1)
  const transfer = results.find((result) => result.legs.length === 2)
  assert.equal(direct.from.id, 'b')
  assert.equal(direct.to.id, 'd')
  assert.deepEqual(transfer.legs.map((leg) => leg.line), ['1', '2'])
  assert.equal(transfer.from.id, 'a')
  assert.equal(transfer.to.id, 'c')
  assert.equal(planRoutes({ ...args, fromStop: originA, fromStops: [originA], toStops: [destinationB] })
    .some((result) => result.legs.length === 1), false)
  const arriveBy = new Date(2026, 10, 24, 9, 30)
  const arriving = planRoutes({ ...args, searchMode: 'arrive', departureAt: arriveBy })
  assert.ok(arriving.length)
  assert.ok(arriving.every((result) => result.arrivesAt <= arriveBy))
})

test('offers a direct ride with an estimated walk and checks arrival after walking', () => {
  const origin = stop('origin', 'Algus', 59.43)
  const nearby = stop('near', 'Maha', 59.44)
  const destination = stop('destination', 'Siht', 59.445)
  const far = stop('far', 'Kaugel', 59.46)
  const transferStop = stop('transfer', 'Ümberistumine', 59.435)
  const stops = [origin, nearby, destination, far, transferStop]
  for (const item of stops) item.transferOptions = [{ stop: item, distance: 0, walkMinutes: 0 }]
  const trip = {
    id: 'walk-trip',
    route: { id: '2', number: '2', type: 'bus', name: '2', destination: 'Maha' },
    serviceIndex: 0,
    stopTimes: [[origin, 9 * 60 + 5], [nearby, 9 * 60 + 10]].map(([item, minute]) => ({
      stop: item, arrivalSeconds: minute * 60, departureSeconds: minute * 60,
      pickupType: '0', dropOffType: '0',
    })),
  }
  const transferTrip = (id, line, entries) => ({
    id,
    route: { id: line, number: line, type: 'bus', name: line, destination: 'Siht' },
    serviceIndex: 0,
    stopTimes: entries.map(([item, minute]) => ({
      stop: item, arrivalSeconds: minute * 60, departureSeconds: minute * 60,
      pickupType: '0', dropOffType: '0',
    })),
  })
  const data = {
    stops,
    trips: [
      trip,
      transferTrip('transfer-1', '3', [[origin, 9 * 60 + 4], [transferStop, 9 * 60 + 8]]),
      transferTrip('transfer-2', '4', [[transferStop, 9 * 60 + 15], [destination, 9 * 60 + 30]]),
    ],
    services: [{ start: '20260101', end: '20261231', weekdays: [1, 1, 1, 1, 1, 1, 1] }],
    exceptions: [],
  }
  const at = new Date(2026, 10, 24, 9, 0)
  const args = { fromStops: [origin], toStops: [destination], data, now: at, departureAt: at }
  const [result] = planRoutes(args)
  assert.equal(result.legs[0].line, '2')
  assert.equal(result.legs.length, 1)
  assert.equal(result.legs[0].pathStops.at(-1), nearby)
  assert.equal(result.to, destination)
  assert.equal(result.destinationWalk.from, nearby)
  assert.ok(result.destinationWalk.distanceMeters > 500 && result.destinationWalk.distanceMeters <= 1000)
  assert.equal(result.arrivesAt - result.legs[0].arrivalAt, result.destinationWalk.minutes * 60_000)
  assert.equal(planRoutes({ ...args, toStops: [far] }).length, 0)
  const tooEarly = new Date(result.arrivesAt.getTime() - 60_000)
  assert.equal(planRoutes({ ...args, searchMode: 'arrive', departureAt: tooEarly }).length, 0)
  assert.equal(planRoutes({ ...args, searchMode: 'arrive', departureAt: result.arrivesAt }).length, 1)

  const walking = planRoutes({ ...args, fromStops: [nearby] })
  assert.equal(walking[0].isWalkingOnly, true)
  assert.equal(walking[0].from, nearby)
  assert.equal(walking[0].to, destination)
  assert.equal(walking[0].arrivesAt - walking[0].departsAt, walking[0].durationMinutes * 60_000)
  const arrivingWalk = planRoutes({ ...args, fromStops: [nearby], searchMode: 'arrive' })
  assert.equal(arrivingWalk[0].arrivesAt.getTime(), at.getTime())
})
