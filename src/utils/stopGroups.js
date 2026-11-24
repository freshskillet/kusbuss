import { distanceBetween } from './etaCalculator.js'

const GROUP_DISTANCE_METERS = 500

function displayName(stop, stopsById) {
  const parent = stopsById.get(stop.parentStation)
  return (parent?.name || stop.name).replace(/\s*\(train station\)$/i, '').trim()
}

export function groupStops(stops) {
  const stopsById = new Map(stops.map((stop) => [stop.id, stop]))
  const groups = []
  const byName = new Map()
  const groupByStopId = new Map()

  for (const stop of stops) {
    const name = displayName(stop, stopsById)
    const key = name.toLocaleLowerCase('et')
    const candidates = byName.get(key) || []
    let group = candidates.find((candidate) =>
      Number.isFinite(stop.coordinates.lat) && Number.isFinite(stop.coordinates.lon) &&
      Number.isFinite(candidate.stops[0].coordinates.lat) && Number.isFinite(candidate.stops[0].coordinates.lon) &&
      distanceBetween(stop.coordinates, candidate.stops[0].coordinates) <= GROUP_DISTANCE_METERS,
    )
    if (!group) {
      group = { id: stop.id, name, area: stop.area, stops: [] }
      candidates.push(group)
      byName.set(key, candidates)
      groups.push(group)
    }
    group.stops.push(stop)
    groupByStopId.set(stop.id, group)
  }

  byName.forEach((candidates) => {
    candidates.forEach((group, index) => {
      const area = group.area ? ` · ${group.area}` : ''
      const sameArea = candidates.filter((candidate) => candidate.area === group.area)
      group.label = candidates.length > 1
        ? `${group.name}${area}${sameArea.length > 1 ? ` · ${index + 1}` : ''}`
        : group.name
    })
  })

  return { groups, groupByStopId }
}
