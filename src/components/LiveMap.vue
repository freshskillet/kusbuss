<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const props = defineProps({
  stops: { type: Array, required: true },
  vehicles: { type: Array, default: () => [] },
  trip: { type: Object, default: null },
  userLocation: { type: Object, default: null },
  satellite: { type: Boolean, default: false },
})
const emit = defineEmits(['map-error'])

const mapElement = ref(null)
let map
let stopLayer
let routeLayer
let userMarker
let vehicleLayer
let resizeObserver
let resizeFrame
const vehicleMarkers = new Map()
const vehiclePositions = new Map()
const vehicleAnimations = new Map()
const vehicleHeadings = new Map()
const vehicleCompact = new Map()
const typeColors = {
  bus: { background: '#00c99a', foreground: '#08251e' },
  tram: { background: '#ff642e', foreground: '#2a1008' },
  trolley: { background: '#174d9b', foreground: '#ffffff' },
  county: { background: '#ffbf80', foreground: '#3b2109' },
  rail: { background: '#c4b5fd', foreground: '#241747' },
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

function createVehicleIcon(vehicle, compact) {
  const colors = typeColors[vehicle.transportType] || { background: '#d5ddd6', foreground: '#101311' }
  if (compact) {
    return L.divIcon({
      html: `<span class="vehicle-dot" style="--vehicle-color:${colors.background}"></span>`,
      className: 'vehicle-marker',
      iconSize: [10, 10],
      iconAnchor: [5, 5],
    })
  }
  const line = escapeHtml(vehicle.line)
  const arrow = Number.isFinite(vehicle.heading) ? '<span class="vehicle-arrow"></span>' : ''
  const html = `<span class="vehicle-pin" style="--vehicle-color:${colors.background};--vehicle-foreground:${colors.foreground};--vehicle-heading:${vehicle.heading ?? 0}deg">${arrow}<span class="vehicle-line">${line}</span></span>`
  return L.divIcon({
    html,
    className: 'vehicle-marker',
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  })
}

function renderStops() {
  stopLayer.clearLayers()
  const routeStops = props.trip?.legs?.flatMap((leg) => leg.pathStops) || []
  const uniqueStops = [...new Map(routeStops.map((stop) => [stop.id, stop])).values()]
  uniqueStops.forEach((stop) => {
    const accessibility = stop.wheelchairBoarding === '1'
      ? 'Ligipääsetav ratastooliga'
      : stop.wheelchairBoarding === '2'
        ? 'Ratastooliga ligipääsmatu'
        : 'Ligipääsetavuse info puudub'
    const name = escapeHtml(stop.name)
    const platform = stop.platform ? ` · platvorm ${escapeHtml(stop.platform)}` : ''
    const area = stop.area ? `<br>${escapeHtml(stop.area)}` : ''
    L.circleMarker([stop.coordinates.lat, stop.coordinates.lon], {
      radius: 5,
      color: '#101311',
      weight: 2,
      fillColor: '#f5f7f5',
      fillOpacity: 1,
    })
      .bindTooltip(`${name}${platform}${area}<br>${accessibility}`, {
        direction: 'top',
        offset: [0, -5],
        className: 'stop-tooltip',
      })
      .addTo(stopLayer)
  })
}

function renderRoute() {
  routeLayer.clearLayers()
  if (!props.trip) return

  const routeLegs = props.trip.routeLegs || props.trip.legs
  routeLegs.forEach((leg) => {
    if (leg.shapePoints.length > 1) {
      L.polyline(
        leg.shapePoints.map((point) => [point.lat, point.lon]),
        {
          color: leg.type === 'walk' ? '#d5ddd6' : typeColors[leg.transportType]?.background || '#b7f36b',
          weight: leg.type === 'walk' ? 3 : 5,
          dashArray: leg.type === 'walk' ? '6 7' : null,
          opacity: 0.92,
          lineCap: 'round',
          lineJoin: 'round',
        },
      ).addTo(routeLayer)
    }
  })

  if (props.trip.routeLegs) {
    const first = routeLegs[0]?.shapePoints[0]
    const last = routeLegs.at(-1)?.shapePoints.at(-1)
    if (first) L.circleMarker([first.lat, first.lon], {
      radius: 8, color: '#101311', weight: 3, fillColor: '#b7f36b', fillOpacity: 1,
    }).bindTooltip('Algus').addTo(routeLayer)
    if (last) L.circleMarker([last.lat, last.lon], {
      radius: 8, color: '#101311', weight: 3, fillColor: '#ff8879', fillOpacity: 1,
    }).bindTooltip('Sihtkoht').addTo(routeLayer)
    return
  }

  const first = props.trip.legs[0]?.pathStops[0] || props.trip.destinationWalk?.from
  const last = props.trip.legs.at(-1)?.pathStops.at(-1) || props.trip.destinationWalk?.from
  if (!first || !last) return
  L.circleMarker([first.coordinates.lat, first.coordinates.lon], {
    radius: 8, color: '#101311', weight: 3, fillColor: '#b7f36b', fillOpacity: 1,
  }).bindTooltip(props.trip.isWalkingOnly ? 'Algus' : 'Peale').addTo(routeLayer)
  if (!props.trip.isWalkingOnly) {
    L.circleMarker([last.coordinates.lat, last.coordinates.lon], {
      radius: 8, color: '#101311', weight: 3, fillColor: '#ff8879', fillOpacity: 1,
    }).bindTooltip('Maha').addTo(routeLayer)
  }
  if (props.trip.destinationWalk) {
    const destination = props.trip.destinationWalk.to.coordinates
    L.polyline([
      [last.coordinates.lat, last.coordinates.lon],
      [destination.lat, destination.lon],
    ], { color: '#d5ddd6', weight: 3, dashArray: '6 7' })
      .bindTooltip('Hinnanguline sirgjoon, mitte kõnniteekond')
      .addTo(routeLayer)
    L.circleMarker([destination.lat, destination.lon], {
      radius: 8, color: '#101311', weight: 3, fillColor: '#ff8879', fillOpacity: 1,
    }).bindTooltip('Sihtkoht').addTo(routeLayer)
  }
}

function vehiclesToShow() {
  if (!props.trip) {
    const bounds = map.getBounds()
    return props.vehicles.filter((vehicle) => bounds.contains(L.latLng(vehicle.lat, vehicle.lon)))
  }
  return props.trip.legs.flatMap((leg) => {
    if (!leg.vehicle) return []
    const selected = props.vehicles.find((vehicle) =>
      vehicle.vehicleId === leg.vehicle.vehicleId &&
      vehicle.line.toLowerCase() === leg.line.toLowerCase() &&
      vehicle.transportType === leg.transportType,
    )
    return selected ? [selected] : []
  })
}

function vehicleKey(vehicle) {
  return `${vehicle.transportType}:${vehicle.line}:${vehicle.vehicleId}`
}

function updateVehicles() {
  if (!map || !vehicleLayer) return
  const vehicles = vehiclesToShow()
  const compact = !props.trip && map.getZoom() < 15
  const visibleIds = new Set(vehicles.map(vehicleKey))
  let needsFocus = false

  vehicleMarkers.forEach((marker, id) => {
    if (!visibleIds.has(id)) {
      const activeAnimation = vehicleAnimations.get(id)
      if (activeAnimation) cancelAnimationFrame(activeAnimation)
      vehicleAnimations.delete(id)
      vehicleLayer.removeLayer(marker)
      vehicleMarkers.delete(id)
      vehiclePositions.delete(id)
      vehicleHeadings.delete(id)
      vehicleCompact.delete(id)
    }
  })

  vehicles.forEach((vehicle) => {
    const id = vehicleKey(vehicle)
    const next = L.latLng(vehicle.lat, vehicle.lon)
    const existing = vehicleMarkers.get(id)
    if (!existing) {
      if (props.trip && !map.getBounds().contains(next)) needsFocus = true
      const marker = L.marker(next, {
        icon: createVehicleIcon(vehicle, compact),
        title: `${vehicle.transportType === 'tram' ? 'Tramm' : vehicle.transportType === 'trolley' ? 'Troll' : 'Buss'} ${vehicle.line}`,
        zIndexOffset: 500,
      })
        .bindTooltip(`${vehicle.transportType === 'tram' ? 'Tramm' : vehicle.transportType === 'trolley' ? 'Troll' : 'Buss'} ${escapeHtml(vehicle.line)}`)
        .addTo(vehicleLayer)
      vehicleMarkers.set(id, marker)
      vehiclePositions.set(id, next)
      vehicleHeadings.set(id, vehicle.heading)
      vehicleCompact.set(id, compact)
      return
    }

    if (vehicleHeadings.get(id) !== vehicle.heading || vehicleCompact.get(id) !== compact) {
      existing.setIcon(createVehicleIcon(vehicle, compact))
      vehicleHeadings.set(id, vehicle.heading)
      vehicleCompact.set(id, compact)
    }
    const previous = vehiclePositions.get(id) || existing.getLatLng()
    if (previous.lat === next.lat && previous.lng === next.lng) return
    vehiclePositions.set(id, next)
    const startedAt = performance.now()
    const duration = 750

    function animate(now) {
      const progress = Math.min(1, (now - startedAt) / duration)
      existing.setLatLng([
        previous.lat + (next.lat - previous.lat) * progress,
        previous.lng + (next.lng - previous.lng) * progress,
      ])
      if (progress < 1) {
        vehicleAnimations.set(id, requestAnimationFrame(animate))
      } else {
        vehicleAnimations.delete(id)
      }
    }
    const previousAnimation = vehicleAnimations.get(id)
    if (previousAnimation) cancelAnimationFrame(previousAnimation)
    vehicleAnimations.set(id, requestAnimationFrame(animate))
  })
  if (needsFocus) focusMap()
}

function updateUserLocation() {
  if (!map || !props.userLocation) {
    if (userMarker && map) map.removeLayer(userMarker)
    userMarker = null
    return
  }
  const point = [props.userLocation.lat, props.userLocation.lon]
  if (!userMarker) {
    userMarker = L.circleMarker(point, {
      radius: 8, color: '#101311', weight: 3, fillColor: '#82b8ff', fillOpacity: 1,
    }).bindTooltip('Minu asukoht').addTo(map)
  } else {
    userMarker.setLatLng(point)
  }
}

function focusMap() {
  if (!map) return
  const points = (props.trip?.routeLegs || props.trip?.legs)?.flatMap((leg) =>
    leg.shapePoints.map((point) => [point.lat, point.lon]),
  ) || []
  if (props.trip?.destinationWalk) {
    const origin = props.trip.destinationWalk.from.coordinates
    const destination = props.trip.destinationWalk.to.coordinates
    points.push([origin.lat, origin.lon])
    points.push([destination.lat, destination.lon])
  }
  if (props.trip) vehiclesToShow().forEach((vehicle) => points.push([vehicle.lat, vehicle.lon]))
  if (!points.length && props.userLocation) points.push([props.userLocation.lat, props.userLocation.lon])
  if (points.length > 1) {
    map.fitBounds(L.latLngBounds(points), { padding: [34, 34], maxZoom: 15 })
  } else if (points.length === 1) {
    map.setView(points[0], 14)
  } else {
    map.setView([59.437, 24.7536], 13)
  }
}

onMounted(() => {
  map = L.map(mapElement.value, { zoomControl: true, preferCanvas: true }).setView([59.437, 24.7536], 13)
  const tileUrl = props.satellite
    ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  const tiles = L.tileLayer(tileUrl, {
    maxZoom: 19,
    attribution: props.satellite
      ? 'Imagery &copy; Esri, Vantor,<br>Earthstar Geographics, GIS User Community'
      : '&copy; OpenStreetMap contributors',
  })
  if (props.satellite) {
    tiles.once('tileerror', () => {
      if (!map) return
      map.removeLayer(tiles)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map)
      emit('map-error', 'Satelliidipilt pole saadaval; kuvatakse tavakaart.')
    })
  }
  tiles.addTo(map)
  stopLayer = L.layerGroup().addTo(map)
  routeLayer = L.layerGroup().addTo(map)
  vehicleLayer = L.layerGroup().addTo(map)
  renderStops()
  renderRoute()
  updateVehicles()
  updateUserLocation()
  focusMap()
  if (!props.trip) map.on('moveend', updateVehicles)
  resizeObserver = new ResizeObserver(() => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null
      map?.invalidateSize({ pan: false })
    })
  })
  resizeObserver.observe(mapElement.value)
})

watch(() => props.vehicles, updateVehicles)
watch(() => props.trip?.legs?.map((leg) => `${leg.trackingKey}:${leg.vehicle?.vehicleId ?? ''}`).join('|'), updateVehicles)
watch(() => props.trip ? `${props.trip.id}-${props.trip.departsAt?.getTime()}` : '', () => {
  renderStops()
  renderRoute()
  updateVehicles()
  focusMap()
})
watch(() => props.userLocation, updateUserLocation, { deep: true })

onUnmounted(() => {
  resizeObserver?.disconnect()
  if (resizeFrame) cancelAnimationFrame(resizeFrame)
  vehicleAnimations.forEach((frame) => cancelAnimationFrame(frame))
  map?.remove()
  map = null
})
</script>

<template>
  <div ref="mapElement" class="live-map" role="application" aria-label="Tallinna ühistranspordi kaart"></div>
</template>

<style>
.live-map { width: 100%; height: 390px; overflow: hidden; border: 1px solid #536957; border-radius: 23px; background: #26342a; }
.live-map .leaflet-tile-pane { filter: brightness(.58) saturate(.75); }
.vehicle-marker { border: 0; background: transparent; }
.vehicle-dot { display: block; width: 10px; height: 10px; border: 1px solid #142019; border-radius: 50%; background: var(--vehicle-color); box-shadow: 0 1px 3px #000b; }
.vehicle-pin { position: relative; display: grid; width: 38px; height: 38px; place-items: center; border: 2px solid #172019; border-radius: 50%; color: var(--vehicle-foreground); background: var(--vehicle-color); box-shadow: 0 2px 8px #0008; }
.vehicle-line { position: relative; z-index: 1; font: 700 14px/1 'Segoe UI', Arial, sans-serif; }
.vehicle-arrow { position: absolute; top: -5px; left: 13px; width: 0; height: 0; border-right: 5px solid transparent; border-bottom: 10px solid #101311; border-left: 5px solid transparent; transform: rotate(var(--vehicle-heading)); transform-origin: 5px 24px; }
.leaflet-tooltip { font-family: 'Segoe UI', Arial, sans-serif; }
.stop-tooltip { line-height: 1.5; }
@media (max-width: 600px) {
  .live-map { height: 320px; }
}
</style>
