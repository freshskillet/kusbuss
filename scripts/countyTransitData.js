import { Readable } from 'node:stream'
import { parse } from 'csv-parse'
import { unzipSync } from 'fflate'

export const COUNTY_FEED_URL = 'https://eu-gtfs.remix.com/estonia_unified_gtfs.zip'
const COUNTY_COLORS = new Set(['3bb5db', '094f82'])
const REQUIRED_FILES = [
  'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt',
  'calendar_dates.txt', 'shapes.txt', 'feed_info.txt',
]

async function* readRows(files, name) {
  const contents = files[`${name}.txt`]
  if (!contents) throw new Error(`Maakonnaliinide GTFS voost puudub ${name}.txt`)
  function* chunks() {
    for (let offset = 0; offset < contents.length; offset += 64 * 1024) {
      yield contents.subarray(offset, offset + 64 * 1024)
    }
  }
  const parser = Readable.from(chunks()).pipe(parse({
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: false,
  }))
  for await (const row of parser) yield row
}

function numberOrNull(value) {
  if (value === '' || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function timeToSeconds(value) {
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(value || '')
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null
}

function compactStop(stop) {
  return [
    stop.stop_id, stop.stop_code || '', stop.stop_name || '',
    numberOrNull(stop.stop_lat), numberOrNull(stop.stop_lon), stop.stop_desc || '',
    stop.wheelchair_boarding || '', stop.platform_code || '', stop.location_type || '0',
    stop.parent_station || '', stop.stop_timezone || '', stop.stop_url || '',
    stop.tts_stop_name || '', stop.zone_id || '', stop.alias || '', stop.stop_area || '',
    stop.authority || '',
  ]
}

export async function appendCountyTransitData(data, files) {
  const stopsById = new Map()
  const tallinnStops = new Set()
  for await (const stop of readRows(files, 'stops')) {
    stopsById.set(stop.stop_id, stop)
    if (stop.authority === 'Tallinna linn') tallinnStops.add(stop.stop_id)
  }

  const countyRoutes = new Map()
  for await (const route of readRows(files, 'routes')) {
    if (route.route_type === '3' && COUNTY_COLORS.has(route.route_color.toLowerCase())) {
      countyRoutes.set(route.route_id, route)
    }
  }
  const candidateTrips = new Map()
  for await (const trip of readRows(files, 'trips')) {
    if (countyRoutes.has(trip.route_id)) candidateTrips.set(trip.trip_id, trip)
  }

  const selectedRoutes = new Set()
  for await (const entry of readRows(files, 'stop_times')) {
    const trip = candidateTrips.get(entry.trip_id)
    if (trip && tallinnStops.has(entry.stop_id)) selectedRoutes.add(trip.route_id)
  }
  if (!selectedRoutes.size) throw new Error('Maakonnaliinide voost ei leitud Tallinna teenindavaid liine')

  const selectedTrips = new Map([...candidateTrips].filter(([, trip]) => selectedRoutes.has(trip.route_id)))
  const routeIndexes = new Map()
  for (const id of selectedRoutes) {
    const route = countyRoutes.get(id)
    routeIndexes.set(id, data.routes.length)
    data.routes.push({
      id: `county:${id}`,
      number: route.route_short_name || id,
      name: route.route_long_name || '',
      type: 'county',
      routeType: route.route_type,
      color: route.route_color || '',
      textColor: route.route_text_color || '',
    })
  }

  const neededServices = new Set([...selectedTrips.values()].map((trip) => trip.service_id))
  const serviceIndexes = new Map()
  let latestServiceEnd = ''
  for await (const service of readRows(files, 'calendar')) {
    if (!neededServices.has(service.service_id)) continue
    serviceIndexes.set(service.service_id, data.services.length)
    data.services.push({
      id: `county:${service.service_id}`,
      start: service.start_date,
      end: service.end_date,
      weekdays: [
        service.monday, service.tuesday, service.wednesday, service.thursday,
        service.friday, service.saturday, service.sunday,
      ].map((day) => day === '1'),
    })
    if (service.end_date > latestServiceEnd) latestServiceEnd = service.end_date
  }
  for await (const exception of readRows(files, 'calendar_dates')) {
    if (serviceIndexes.has(exception.service_id)) {
      data.exceptions.push([serviceIndexes.get(exception.service_id), exception.date, Number(exception.exception_type)])
    }
  }

  const stopTimesByTrip = new Map()
  const usedStops = new Set()
  for await (const entry of readRows(files, 'stop_times')) {
    const trip = selectedTrips.get(entry.trip_id)
    if (!trip || !serviceIndexes.has(trip.service_id)) continue
    const arrival = timeToSeconds(entry.arrival_time)
    const departure = timeToSeconds(entry.departure_time)
    if (arrival === null || departure === null || !stopsById.has(entry.stop_id)) continue
    const entries = stopTimesByTrip.get(entry.trip_id) || []
    entries.push({ ...entry, arrival, departure })
    stopTimesByTrip.set(entry.trip_id, entries)
    usedStops.add(entry.stop_id)
  }

  for (const id of [...usedStops]) {
    const parent = stopsById.get(id).parent_station
    if (parent && stopsById.has(parent)) usedStops.add(parent)
  }
  const stopIndexes = new Map(data.stops.map((stop, index) => [stop[0], index]))
  for (const id of usedStops) {
    if (!stopIndexes.has(id)) {
      stopIndexes.set(id, data.stops.length)
      data.stops.push(compactStop(stopsById.get(id)))
    }
  }

  const usedShapes = new Set([...selectedTrips.values()]
    .filter((trip) => stopTimesByTrip.get(trip.trip_id)?.length >= 2 && serviceIndexes.has(trip.service_id))
    .map((trip) => trip.shape_id).filter(Boolean))
  const shapePoints = new Map()
  for await (const point of readRows(files, 'shapes')) {
    if (!usedShapes.has(point.shape_id)) continue
    const points = shapePoints.get(point.shape_id) || []
    points.push(point)
    shapePoints.set(point.shape_id, points)
  }
  const shapeIndexes = new Map()
  for (const id of usedShapes) {
    shapeIndexes.set(id, data.shapes.length)
    data.shapes.push([`county:${id}`, (shapePoints.get(id) || [])
      .sort((a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence))
      .map((point) => [Number(point.shape_pt_lat), Number(point.shape_pt_lon), numberOrNull(point.shape_dist_traveled)])])
  }

  let tripCount = 0
  for (const trip of selectedTrips.values()) {
    const entries = stopTimesByTrip.get(trip.trip_id) || []
    if (entries.length < 2 || !serviceIndexes.has(trip.service_id)) continue
    entries.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence))
    data.trips.push([
      `county:${trip.trip_id}`, routeIndexes.get(trip.route_id), serviceIndexes.get(trip.service_id),
      trip.direction_id || '', shapeIndexes.get(trip.shape_id) ?? -1, trip.trip_headsign || '',
      trip.wheelchair_accessible || '',
      entries.map((entry) => [
        stopIndexes.get(entry.stop_id), entry.arrival, entry.departure,
        numberOrNull(entry.shape_dist_traveled), entry.pickup_type || '0',
        entry.drop_off_type || '0', entry.stop_headsign || '',
      ]),
    ])
    tripCount += 1
  }
  if (!tripCount) throw new Error('Tallinna maakonnaliinidel ei leitud sõiduplaane')
  data.source.county = {
    url: COUNTY_FEED_URL,
    routeCount: selectedRoutes.size,
    tripCount,
    latestServiceEnd,
    refreshedAt: new Date().toISOString(),
  }
}

export async function downloadCountyTransitData(data) {
  const response = await fetch(COUNTY_FEED_URL, { signal: AbortSignal.timeout(180_000) })
  if (!response.ok) throw new Error(`Maakonnaliinide GTFS allalaadimine ebaõnnestus (${response.status})`)
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()), {
    filter: (file) => REQUIRED_FILES.includes(file.name),
  })
  await appendCountyTransitData(data, files)
}
