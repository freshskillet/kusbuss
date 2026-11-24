import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse/sync'
import { gzipSync, unzipSync } from 'fflate'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = resolve(scriptDirectory, '..')
const feedUrl = 'https://eu-gtfs.remix.com/tallinn.zip'
const outputPath = resolve(projectDirectory, 'public/data/tallinn-gtfs.bin')
const requiredFiles = [
  'agency.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'feed_info.txt',
  'routes.txt',
  'shapes.txt',
  'stop_times.txt',
  'stops.txt',
  'trips.txt',
]

function readCsv(files, name) {
  const contents = files[`${name}.txt`]
  if (!contents) return []

  return parse(new TextDecoder('utf-8').decode(contents), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: false,
  })
}

function numberOrNull(value) {
  if (value === '' || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function timeToSeconds(value) {
  if (!value) return null
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(value)
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

function compactStop(stop) {
  return [
    stop.stop_id,
    stop.stop_code || '',
    stop.stop_name || '',
    numberOrNull(stop.stop_lat),
    numberOrNull(stop.stop_lon),
    stop.stop_desc || '',
    stop.wheelchair_boarding || '',
    stop.platform_code || '',
    stop.location_type || '0',
    stop.parent_station || '',
    stop.stop_timezone || '',
    stop.stop_url || '',
    stop.tts_stop_name || '',
    stop.zone_id || '',
    stop.alias || '',
    stop.stop_area || '',
    stop.authority || '',
  ]
}

function compactShapePoint(point) {
  return [
    Number(point.shape_pt_lat),
    Number(point.shape_pt_lon),
    numberOrNull(point.shape_dist_traveled),
  ]
}

async function main() {
  const response = await fetch(feedUrl, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`GTFS voo allalaadimine ebaõnnestus (${response.status})`)

  const files = unzipSync(new Uint8Array(await response.arrayBuffer()))
  const missingFiles = requiredFiles.filter((name) => !files[name])
  if (missingFiles.length) throw new Error(`GTFS voost puuduvad failid: ${missingFiles.join(', ')}`)

  const feedInfo = readCsv(files, 'feed_info')[0] || {}
  const agency = readCsv(files, 'agency')[0] || {}
  const allRoutes = readCsv(files, 'routes')
  const allTrips = readCsv(files, 'trips')
  const allStopTimes = readCsv(files, 'stop_times')
  const allStops = readCsv(files, 'stops')
  const allShapes = readCsv(files, 'shapes')
  const allServices = readCsv(files, 'calendar')
  const allExceptions = readCsv(files, 'calendar_dates')

  const routeIndexById = new Map(allRoutes.map((route, index) => [route.route_id, index]))
  const routes = allRoutes.map((route) => ({
    id: route.route_id,
    number: route.route_short_name || route.route_id,
    name: route.route_long_name || '',
    type: route.route_type === '0'
      ? 'tram'
      : route.route_id.toLowerCase().includes('_trol_')
        ? 'trolley'
        : 'bus',
    routeType: route.route_type,
    color: route.route_color || '',
    textColor: route.route_text_color || '',
  }))

  const serviceIndexById = new Map(allServices.map((service, index) => [service.service_id, index]))
  const services = allServices.map((service) => ({
    id: service.service_id,
    start: service.start_date,
    end: service.end_date,
    weekdays: [
      service.monday,
      service.tuesday,
      service.wednesday,
      service.thursday,
      service.friday,
      service.saturday,
      service.sunday,
    ].map((day) => day === '1'),
  }))
  const exceptions = allExceptions
    .filter((exception) => serviceIndexById.has(exception.service_id))
    .map((exception) => [
      serviceIndexById.get(exception.service_id),
      exception.date,
      Number(exception.exception_type),
    ])

  const tripsById = new Map()
  for (const trip of allTrips) {
    if (!routeIndexById.has(trip.route_id) || !serviceIndexById.has(trip.service_id)) continue
    tripsById.set(trip.trip_id, trip)
  }

  const usedStopIds = new Set()
  const stopTimesByTrip = new Map()
  for (const stopTime of allStopTimes) {
    if (!tripsById.has(stopTime.trip_id)) continue
    const arrival = timeToSeconds(stopTime.arrival_time)
    const departure = timeToSeconds(stopTime.departure_time)
    if (arrival === null || departure === null) continue
    usedStopIds.add(stopTime.stop_id)
    const entries = stopTimesByTrip.get(stopTime.trip_id) || []
    entries.push({ ...stopTime, arrival, departure })
    stopTimesByTrip.set(stopTime.trip_id, entries)
  }

  const parentStopIds = new Set(
    allStops
      .filter((stop) => usedStopIds.has(stop.stop_id) && stop.parent_station)
      .map((stop) => stop.parent_station),
  )
  const stops = allStops.filter((stop) =>
    usedStopIds.has(stop.stop_id) || parentStopIds.has(stop.stop_id),
  )
  const stopIndexById = new Map(stops.map((stop, index) => [stop.stop_id, index]))

  const usedShapeIds = new Set(
    [...tripsById.values()].map((trip) => trip.shape_id).filter(Boolean),
  )
  const shapePointsById = new Map()
  for (const point of allShapes) {
    if (!usedShapeIds.has(point.shape_id)) continue
    const points = shapePointsById.get(point.shape_id) || []
    points.push(point)
    shapePointsById.set(point.shape_id, points)
  }

  const shapes = [...usedShapeIds].map((id) => {
    const points = (shapePointsById.get(id) || [])
      .sort((a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence))
      .map(compactShapePoint)
    return [id, points]
  })
  const shapeIndexById = new Map(shapes.map(([id], index) => [id, index]))

  const trips = []
  for (const trip of tripsById.values()) {
    const stopTimes = (stopTimesByTrip.get(trip.trip_id) || [])
      .sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence))
    if (stopTimes.length < 2 || stopTimes.some((stopTime) => !stopIndexById.has(stopTime.stop_id))) continue

    trips.push([
      trip.trip_id,
      routeIndexById.get(trip.route_id),
      serviceIndexById.get(trip.service_id),
      trip.direction_id || '',
      shapeIndexById.get(trip.shape_id) ?? -1,
      trip.trip_headsign || '',
      trip.wheelchair_accessible || '',
      stopTimes.map((stopTime) => [
        stopIndexById.get(stopTime.stop_id),
        stopTime.arrival,
        stopTime.departure,
        numberOrNull(stopTime.shape_dist_traveled),
        stopTime.pickup_type || '0',
        stopTime.drop_off_type || '0',
        stopTime.stop_headsign || '',
      ]),
    ])
  }

  const data = {
    source: {
      url: feedUrl,
      publisher: feedInfo.feed_publisher_name || agency.agency_name || '',
      agency: agency.agency_name || '',
      agencyUrl: agency.agency_url || '',
      contactUrl: feedInfo.feed_contact_url || '',
      startDate: feedInfo.feed_start_date || '',
      endDate: feedInfo.feed_end_date || '',
      version: feedInfo.feed_version || '',
      refreshedAt: new Date().toISOString(),
      timezone: agency.agency_timezone || 'Europe/Tallinn',
    },
    routes,
    stops: stops.map(compactStop),
    services,
    exceptions,
    shapes,
    trips,
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, gzipSync(new TextEncoder().encode(JSON.stringify(data)), { level: 9 }))

  console.log(
    `GTFS uuendatud: ${routes.length} liini, ${stops.length} peatust, ` +
    `${trips.length} sõitu, ${shapes.length} teekonnakuju. Voo kehtivus: ` +
    `${data.source.startDate}–${data.source.endDate}.`,
  )
  console.log(`Andmestik: ${outputPath}`)
}

main().catch((error) => {
  console.error('GTFS andmete uuendamine ebaõnnestus:', error)
  process.exitCode = 1
})
