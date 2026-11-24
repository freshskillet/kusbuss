export function journeyTimeline(trip, userStop = null, expandedLegs = new Set()) {
  if (trip.routeLegs) {
    const rows = []
    let previousEnd = null
    let transitIndex = 0
    trip.routeLegs.forEach((leg, index) => {
      const startStop = leg.type === 'walk' ? leg.from : leg.pathStops[0]
      const endStop = leg.type === 'walk' ? leg.to : leg.pathStops.at(-1)
      const waiting = previousEnd ? Math.round((leg.departsAt - previousEnd) / 60_000) : 0
      if (waiting > 0) rows.push({ type: 'wait', minutes: waiting, connection: 'wait' })
      const previousStop = waiting > 0 ? null : rows.at(-1)
      const alreadyAtStop = previousStop?.type === 'stop' && previousStop.stop.id === startStop.id
      if (!index || (leg.type === 'transit' && !alreadyAtStop)) {
        rows.push({
          type: 'stop', stop: startStop, timeAt: leg.departsAt,
          marker: index ? leg.transportType : 'origin',
          connection: leg.type === 'walk' ? 'walk' : leg.transportType,
        })
      }
      if (leg.type === 'walk') {
        rows.push({ type: 'walk', minutes: leg.durationMinutes, distanceMeters: leg.distanceMeters, connection: 'walk' })
      } else {
        if (leg.stopTimes.length > 2) {
          rows.push({
            type: 'toggle', legIndex: transitIndex, line: leg.line,
            stopCount: leg.stopTimes.length - 2, durationMinutes: leg.durationMinutes,
            connection: leg.transportType,
          })
          if (expandedLegs.has(transitIndex)) {
            leg.stopTimes.slice(1, -1).forEach((entry) => rows.push({
              type: 'stop', stop: entry.stop, timeAt: entry.arrivalAt,
              marker: leg.transportType, connection: leg.transportType,
            }))
          }
        }
        transitIndex += 1
      }
      rows.push({
        type: 'stop', stop: endStop, timeAt: leg.arrivalAt,
        marker: index === trip.routeLegs.length - 1 ? 'destination' : leg.transportType || 'transfer',
        connection: index === trip.routeLegs.length - 1 ? null
          : trip.routeLegs[index + 1].departsAt > leg.arrivalAt ? 'wait'
            : trip.routeLegs[index + 1].type === 'walk' ? 'walk' : trip.routeLegs[index + 1].transportType,
      })
      previousEnd = leg.arrivalAt
    })
    return rows
  }

  const rows = []
  const addStop = (stop, timeAt, marker, connection, detail, line = '') => {
    rows.push({ type: 'stop', stop, timeAt, marker, connection, detail, line })
  }
  const addWalk = (minutes, distanceMeters = null, estimated = false) => {
    rows.push({ type: 'walk', minutes, distanceMeters, estimated, connection: 'walk' })
  }

  if (userStop) {
    rows.push({
      type: 'location',
      timeAt: new Date(trip.departsAt.getTime() - trip.walkMinutes * 60_000),
      marker: 'origin',
      connection: 'walk',
    })
    addWalk(trip.walkMinutes, null, true)
  }

  if (trip.isWalkingOnly) {
    addStop(trip.from, trip.departsAt, 'origin', 'walk', 'walk-start')
  } else {
    trip.legs.forEach((leg, legIndex) => {
      if (legIndex > 0) {
        const previous = trip.legs[legIndex - 1]
        const from = previous.pathStops.at(-1)
        const to = leg.pathStops[0]
        const walking = leg.transferWalkMinutes
        const transferMinutes = Math.max(0, Math.round((leg.departsAt - previous.arrivalAt) / 60_000))
        const waiting = Math.max(0, transferMinutes - walking)
        if (from.id !== to.id) {
          if (walking) addWalk(walking, null, true)
          addStop(to, new Date(previous.arrivalAt.getTime() + walking * 60_000), 'transfer', waiting ? 'wait' : leg.transportType, 'transfer-arrival')
        }
        if (waiting) rows.push({ type: 'wait', minutes: waiting, connection: 'wait' })
      }

      leg.stopTimes.forEach((entry, index) => {
        const boarding = index === 0
        const alighting = index === leg.stopTimes.length - 1
        if (!boarding && !alighting && !expandedLegs.has(legIndex)) return
        const lastLeg = legIndex === trip.legs.length - 1
        let connection = leg.transportType
        if (alighting) {
          if (!lastLeg) {
            const next = trip.legs[legIndex + 1]
            connection = next.transferWalkMinutes
              ? 'walk'
              : next.departsAt > leg.arrivalAt ? 'wait' : next.transportType
          } else {
            connection = trip.destinationWalk ? 'walk' : null
          }
        }
        const marker = boarding && legIndex === 0 && !userStop
          ? 'origin'
          : alighting && lastLeg && !trip.destinationWalk
            ? 'destination'
            : leg.transportType
        const detail = boarding ? 'boarding' : alighting ? (lastLeg ? 'alighting' : 'transfer') : 'intermediate'
        addStop(entry.stop, boarding ? entry.departureAt : entry.arrivalAt, marker, connection, detail, leg.line)
        if (boarding && legIndex === 0) rows.at(-1).firstBoarding = true
        if (boarding && leg.stopTimes.length > 2) {
          rows.push({
            type: 'toggle',
            legIndex,
            line: leg.line,
            stopCount: leg.stopTimes.length - 2,
            durationMinutes: leg.durationMinutes,
            connection: leg.transportType,
          })
        }
      })
    })
  }

  if (trip.destinationWalk) {
    addWalk(trip.destinationWalk.minutes, trip.destinationWalk.distanceMeters, true)
    addStop(trip.to, trip.arrivesAt, 'destination', null, 'destination')
  }

  return rows
}
