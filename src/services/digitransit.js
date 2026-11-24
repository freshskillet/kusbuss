const QUERY = `
  query Itineraries(
    $origin: PlanLabeledLocationInput!
    $destination: PlanLabeledLocationInput!
    $dateTime: PlanDateTimeInput!
    $first: Int
    $last: Int
  ) {
    planConnection(origin: $origin, destination: $destination, dateTime: $dateTime, first: $first, last: $last) {
      routingErrors { code description inputField }
      edges {
        node {
          start end duration walkDistance walkTime waitingTime numberOfTransfers
          legs {
            id mode transitLeg serviceDate duration distance headsign
            from { name lat lon stop { gtfsId name lat lon } }
            to { name lat lon stop { gtfsId name lat lon } }
            start { scheduledTime }
            end { scheduledTime }
            route { gtfsId shortName longName agency { name } }
            trip { gtfsId }
            legGeometry { points }
            stopCalls {
              stopLocation {
                __typename
                ... on Stop { gtfsId name lat lon }
                ... on Location { gtfsId locationName: name }
                ... on LocationGroup { gtfsId locationGroupName: name }
              }
              schedule {
                time {
                  __typename
                  ... on ArrivalDepartureTime { arrival departure timePoint }
                  ... on TimeWindow { start end }
                }
              }
              realTime {
                arrival { time delay }
                departure { time delay }
              }
            }
          }
        }
      }
    }
  }
`

function location(place) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)
    || Math.abs(place.lat) > 90 || Math.abs(place.lon) > 180) {
    throw new TypeError('Invalid coordinates')
  }
  return {
    ...(place.name != null ? { label: place.name } : {}),
    location: { coordinate: { latitude: place.lat, longitude: place.lon } },
  }
}

export async function fetchItineraries({ from, to, at, searchMode, signal }) {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new TypeError('Invalid date')
  if (searchMode !== 'depart' && searchMode !== 'arrive') throw new TypeError('Invalid search mode')

  const variables = {
    origin: location(from),
    destination: location(to),
    dateTime: searchMode === 'depart'
      ? { earliestDeparture: at.toISOString() }
      : { latestArrival: at.toISOString() },
    ...(searchMode === 'depart' ? { first: 5 } : { last: 5 }),
  }
  const response = await fetch('/api/digitransit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables }),
    signal,
  })
  if (!response.ok) {
    const error = new Error(`Digitransit HTTP error: ${response.status}`)
    error.status = response.status
    throw error
  }

  const result = await response.json()
  if (result?.errors?.length) {
    const error = new Error('Digitransit GraphQL error')
    error.graphQLErrors = result.errors
    throw error
  }
  const plan = result?.data?.planConnection
  if (!plan || !Array.isArray(plan.routingErrors)) {
    throw new Error('Invalid Digitransit response')
  }
  if (plan.routingErrors.length) {
    const error = new Error('Digitransit routing error')
    error.routingErrors = plan.routingErrors
    throw error
  }
  if (!Array.isArray(plan.edges) || plan.edges.some((edge) => !edge || !edge.node)) {
    throw new Error('Invalid Digitransit response')
  }
  return plan.edges.map((edge) => edge.node)
}

export function decodePolyline(points) {
  if (typeof points !== 'string') throw new TypeError('Polyline must be a string')

  let index = 0
  let lat = 0
  let lon = 0
  const decoded = []

  function readDelta() {
    let value = 0
    let factor = 1
    let count = 0
    while (true) {
      if (index >= points.length || count === 6) throw new Error('Malformed polyline')
      const code = points.charCodeAt(index++) - 63
      if (code < 0 || code > 63) throw new Error('Malformed polyline')
      value += (code & 31) * factor
      count++
      if (code < 32) {
        if (count > 1 && code === 0) throw new Error('Malformed polyline')
        return value % 2 ? -(value + 1) / 2 : value / 2
      }
      factor *= 32
    }
  }

  while (index < points.length) {
    lat += readDelta()
    lon += readDelta()
    if (Math.abs(lat) > 9000000 || Math.abs(lon) > 18000000) {
      throw new Error('Malformed polyline')
    }
    decoded.push({ lat: lat / 100000, lon: lon / 100000 })
  }
  return decoded
}
