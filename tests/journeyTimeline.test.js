import test from 'node:test'
import assert from 'node:assert/strict'
import { journeyTimeline } from '../src/utils/journeyTimeline.js'

const at = (minute) => new Date(2026, 10, 24, 9, minute)
const stop = (id) => ({ id, name: id })
const a = stop('Algus')
const b = stop('Ümberistumine')
const c = stop('Teine peatus')
const d = stop('Siht')

function leg(from, to, start, end, transportType, line, transferWalkMinutes = 0) {
  return {
    line, transportType, transferWalkMinutes,
    departsAt: at(start), arrivalAt: at(end),
    pathStops: [from, to],
    stopTimes: [
      { stop: from, arrivalAt: at(start - 1), departureAt: at(start) },
      { stop: to, arrivalAt: at(end), departureAt: at(end) },
    ],
  }
}

test('shows departure and arrival with the ride colour and destination walk', () => {
  const trip = {
    from: a, to: d, legs: [leg(a, b, 5, 10, 'bus', '2')],
    departsAt: at(5), arrivesAt: at(15),
    destinationWalk: { minutes: 5, distanceMeters: 350 },
  }
  const rows = journeyTimeline(trip)
  assert.deepEqual(rows.map((row) => row.type), ['stop', 'stop', 'walk', 'stop'])
  assert.deepEqual(rows.map((row) => row.connection), ['bus', 'walk', 'walk', null])
  assert.equal(rows[0].timeAt.getTime(), at(5).getTime())
  assert.equal(rows.at(-1).timeAt.getTime(), at(15).getTime())
  assert.equal(rows[2].minutes, 5)
})

test('distinguishes walking and waiting on a transfer and changes line colour', () => {
  const trip = {
    legs: [leg(a, b, 5, 10, 'bus', '2'), leg(c, d, 17, 25, 'tram', '1', 3)],
    departsAt: at(5), arrivesAt: at(25),
  }
  const rows = journeyTimeline(trip)
  assert.deepEqual(rows.map((row) => row.type), ['stop', 'stop', 'walk', 'stop', 'wait', 'stop', 'stop'])
  assert.deepEqual(rows.map((row) => row.connection), ['bus', 'walk', 'walk', 'wait', 'wait', 'tram', null])
  assert.equal(rows[2].minutes, 3)
  assert.equal(rows[3].timeAt.getTime(), at(13).getTime())
  assert.equal(rows[4].minutes, 4)
  assert.equal(rows[5].timeAt.getTime(), at(17).getTime())
})

test('shows waiting rather than walking for a same-stop transfer', () => {
  const trip = {
    legs: [leg(a, b, 5, 10, 'tram', '1'), leg(b, d, 15, 25, 'trolley', '3')],
    departsAt: at(5), arrivesAt: at(25),
  }
  const rows = journeyTimeline(trip)
  assert.deepEqual(rows.map((row) => row.type), ['stop', 'stop', 'wait', 'stop', 'stop'])
  assert.equal(rows[2].minutes, 5)
  assert.equal(rows[3].connection, 'trolley')
})

test('shows walking-only and initial-location walks', () => {
  const walkTrip = {
    from: a, to: d, legs: [], isWalkingOnly: true,
    departsAt: at(5), arrivesAt: at(10),
    destinationWalk: { minutes: 5, distanceMeters: 350 },
  }
  assert.deepEqual(journeyTimeline(walkTrip).map((row) => row.connection), ['walk', 'walk', null])
  const rideTrip = {
    legs: [leg(a, d, 5, 10, 'bus', '2')],
    departsAt: at(5), arrivesAt: at(10), walkMinutes: 3,
  }
  const rows = journeyTimeline(rideTrip, { stop: a })
  assert.equal(rows[0].timeAt.getTime(), at(2).getTime())
  assert.equal(rows[1].minutes, 3)
  assert.equal(rows[2].connection, 'bus')
})

test('collapses intermediate stops by default and expands each leg independently', () => {
  const first = leg(a, b, 5, 10, 'bus', '2')
  const second = leg(b, d, 15, 25, 'tram', '1')
  first.durationMinutes = 5
  second.durationMinutes = 10
  first.stopTimes.splice(1, 0,
    { stop: stop('Esimene'), arrivalAt: at(7), departureAt: at(7) },
    { stop: stop('Teine'), arrivalAt: at(8), departureAt: at(8) })
  second.stopTimes.splice(1, 0, { stop: c, arrivalAt: at(20), departureAt: at(20) })
  const trip = { legs: [first, second], departsAt: at(5), arrivesAt: at(25) }

  const collapsed = journeyTimeline(trip)
  assert.deepEqual(collapsed.filter((row) => row.type === 'toggle').map((row) =>
    [row.legIndex, row.stopCount, row.durationMinutes, row.connection]),
  [[0, 2, 5, 'bus'], [1, 1, 10, 'tram']])
  assert.deepEqual(collapsed.filter((row) => row.type === 'stop').map((row) => row.stop.id),
    ['Algus', 'Ümberistumine', 'Ümberistumine', 'Siht'])
  assert.equal(collapsed.find((row) => row.type === 'wait').minutes, 5)

  const firstOpen = journeyTimeline(trip, null, new Set([0]))
  assert.deepEqual(firstOpen.filter((row) => row.detail === 'intermediate').map((row) => row.stop.id),
    ['Esimene', 'Teine'])
  const secondOpen = journeyTimeline(trip, null, new Set([1]))
  assert.deepEqual(secondOpen.filter((row) => row.detail === 'intermediate').map((row) => row.stop.id),
    ['Teine peatus'])
  assert.equal(journeyTimeline(trip, null, new Set([0, 1])).filter((row) => row.detail === 'intermediate').length, 3)
})
