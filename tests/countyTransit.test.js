import test from 'node:test'
import assert from 'node:assert/strict'
import { appendCountyTransitData } from '../scripts/countyTransitData.js'
import { planRoutes, getDeparturesAtStop } from '../src/services/routePlanner.js'

function csv(headers, rows) {
  return new TextEncoder().encode([headers.join(','), ...rows.map((row) =>
    headers.map((header) => row[header] ?? '').join(','))].join('\n'))
}

test('imports Tallinn county routes and all their variants without mixing feeds', async () => {
  const files = {
    'stops.txt': csv(['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'authority'], [
      { stop_id: 'city', stop_name: 'Tallinn', stop_lat: 59.43, stop_lon: 24.75, authority: 'Tallinna linn' },
      { stop_id: 'kiili', stop_name: 'Kiili', stop_lat: 59.31, stop_lon: 24.84, authority: 'Harjumaa' },
      { stop_id: 'other', stop_name: 'Muu', stop_lat: 58, stop_lon: 25, authority: 'Muu' },
    ]),
    'routes.txt': csv(['route_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color'], [
      { route_id: '116', route_short_name: '116', route_long_name: 'Tallinn - Kiili', route_type: 3, route_color: '3bb5db' },
      { route_id: 'other', route_short_name: '1', route_type: 3, route_color: '3bb5db' },
      { route_id: 'express', route_short_name: '2', route_type: 3, route_color: '660000' },
    ]),
    'trips.txt': csv(['trip_id', 'route_id', 'service_id', 'shape_id'], [
      { trip_id: 'inbound', route_id: '116', service_id: 'day', shape_id: 'shape' },
      { trip_id: 'branch', route_id: '116', service_id: 'day', shape_id: 'shape' },
      { trip_id: 'other', route_id: 'other', service_id: 'day' },
      { trip_id: 'express', route_id: 'express', service_id: 'day' },
    ]),
    'stop_times.txt': csv(['trip_id', 'stop_id', 'stop_sequence', 'arrival_time', 'departure_time'], [
      { trip_id: 'inbound', stop_id: 'kiili', stop_sequence: 1, arrival_time: '10:00:00', departure_time: '10:00:00' },
      { trip_id: 'inbound', stop_id: 'city', stop_sequence: 2, arrival_time: '10:30:00', departure_time: '10:30:00' },
      { trip_id: 'branch', stop_id: 'kiili', stop_sequence: 1, arrival_time: '11:00:00', departure_time: '11:00:00' },
      { trip_id: 'branch', stop_id: 'other', stop_sequence: 2, arrival_time: '11:30:00', departure_time: '11:30:00' },
      { trip_id: 'other', stop_id: 'other', stop_sequence: 1, arrival_time: '10:00:00', departure_time: '10:00:00' },
      { trip_id: 'express', stop_id: 'city', stop_sequence: 1, arrival_time: '10:00:00', departure_time: '10:00:00' },
    ]),
    'calendar.txt': csv(['service_id', 'start_date', 'end_date', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], [
      { service_id: 'day', start_date: '20260101', end_date: '20261231', monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 1, sunday: 1 },
    ]),
    'calendar_dates.txt': csv(['service_id', 'date', 'exception_type'], [
      { service_id: 'day', date: '20261225', exception_type: 2 },
    ]),
    'shapes.txt': csv(['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence', 'shape_dist_traveled'], [
      { shape_id: 'shape', shape_pt_lat: 59.31, shape_pt_lon: 24.84, shape_pt_sequence: 1, shape_dist_traveled: 0 },
      { shape_id: 'shape', shape_pt_lat: 59.43, shape_pt_lon: 24.75, shape_pt_sequence: 2, shape_dist_traveled: 10000 },
    ]),
  }
  const data = {
    source: {}, routes: [{ id: '116', number: '116', type: 'bus' }],
    stops: [['city', '', 'Tallinn', 59.43, 24.75]], services: [], exceptions: [], shapes: [], trips: [],
  }
  await appendCountyTransitData(data, files)
  assert.equal(data.routes.length, 2)
  assert.equal(data.routes[1].id, 'county:116')
  assert.equal(data.routes[1].type, 'county')
  assert.equal(data.trips.length, 2)
  assert.equal(data.stops.filter((stop) => stop[0] === 'city').length, 1)
  assert.equal(data.trips[0][7][1][0], 0)
  assert.equal(data.shapes[0][0], 'county:shape')
  assert.deepEqual(data.exceptions, [[0, '20261225', 2]])
})

test('county routes never use Tallinn GPS and same-number city departures remain separate', () => {
  const origin = { id: 'kiili', name: 'Kiili', coordinates: { lat: 59.31, lon: 24.84 } }
  const destination = { id: 'city', name: 'Tallinn', coordinates: { lat: 59.43, lon: 24.75 } }
  const shape = { points: [{ lat: 59.31, lon: 24.84, distance: 0 }, { lat: 59.43, lon: 24.75, distance: 10000 }] }
  const entries = [
    { stop: origin, arrivalSeconds: 36000, departureSeconds: 36000, shapeDistance: 500, pickupType: '0' },
    { stop: destination, arrivalSeconds: 37800, departureSeconds: 37800, shapeDistance: 10000, dropOffType: '0' },
  ]
  const trips = ['bus', 'county'].map((type) => ({
    id: type, route: { id: type, number: '116', type, name: 'Tallinn', destination: 'Tallinn' },
    serviceIndex: 0, shape, stopTimes: entries,
  }))
  const data = {
    stops: [origin, destination], trips,
    services: [{ start: '20260101', end: '20261231', weekdays: [true, true, true, true, true, true, true] }],
    exceptions: [],
  }
  const at = new Date(2026, 10, 24, 9, 55)
  const vehicles = [{ line: '116', transportType: 'county', isSimulated: false, lat: 59.31, lon: 24.84, heading: 330, speed: 20 }]
  const board = getDeparturesAtStop(data, origin, at, vehicles)
  assert.equal(board.length, 2)
  assert.equal(board.find((item) => item.transportType === 'county').isLive, false)
  const planned = planRoutes({ fromStops: [origin], toStops: [destination], data, vehicles, now: at, departureAt: at })
  assert.equal(planned.find((trip) => trip.legs[0]?.transportType === 'county').legs[0].isLive, false)
})
