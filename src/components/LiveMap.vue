<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const props = defineProps({
  stops: { type: Array, required: true },
  vehicles: { type: Array, default: () => [] },
  trip: { type: Object, default: null },
  userLocation: { type: Object, default: null },
})

const mapElement = ref(null)
let map
let stopLayer
let routeLayer
let userMarker
let vehicleLayer
const vehicleMarkers = new Map()
const vehiclePositions = new Map()
const vehicleAnimations = new Map()
const typeColors = { bus: '#a8e679', tram: '#ff8879', trolley: '#7facff' }

function createVehicleIcon(vehicle) {
  const color = typeColors[vehicle.transportType] || '#d5ddd6'
  const line = String(vehicle.line).replace(/[&<>"']/g, '')
  const html = `<span class="vehicle-pin" style="--vehicle-color:${color};--vehicle-heading:${Number(vehicle.heading) || 0}deg"><span class="vehicle-arrow"></span><span class="vehicle-line">${line}</span></span>`
  return L.divIcon({
    html,
    className: 'vehicle-marker',
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  })
}

function renderStops() {
  stopLayer.clearLayers()
  props.stops.forEach((stop) => {
    L.circleMarker([stop.coordinates.lat, stop.coordinates.lon], {
      radius: 5,
      color: '#101311',
      weight: 2,
      fillColor: '#f5f7f5',
      fillOpacity: 1,
    })
      .bindTooltip(stop.name, { direction: 'top', offset: [0, -5] })
      .addTo(stopLayer)
  })
}

function renderRoute() {
  routeLayer.clearLayers()
  if (!props.trip?.pathStops?.length) return

  const points = props.trip.pathStops.map((stop) => [stop.coordinates.lat, stop.coordinates.lon])
  L.polyline(points, { color: '#b7f36b', weight: 5, opacity: 0.9, lineCap: 'round' }).addTo(routeLayer)

  const first = props.trip.pathStops[0]
  const last = props.trip.pathStops.at(-1)
  L.circleMarker([first.coordinates.lat, first.coordinates.lon], {
    radius: 8, color: '#101311', weight: 3, fillColor: '#b7f36b', fillOpacity: 1,
  }).bindTooltip('Peale').addTo(routeLayer)
  L.circleMarker([last.coordinates.lat, last.coordinates.lon], {
    radius: 8, color: '#101311', weight: 3, fillColor: '#ff8879', fillOpacity: 1,
  }).bindTooltip('Maha').addTo(routeLayer)
}

function vehiclesToShow() {
  const leg = props.trip?.legs?.[0]
  if (!leg) return props.vehicles

  const candidates = props.vehicles.filter((vehicle) =>
    vehicle.line.toLowerCase() === leg.line.toLowerCase() &&
    vehicle.transportType === leg.transportType,
  )
  const selectedVehicleId = leg.vehicle?.vehicleId
  const selected = candidates.find((vehicle) => vehicle.vehicleId === selectedVehicleId)
  return selected ? [selected] : []
}

function updateVehicles() {
  if (!map || !vehicleLayer) return
  const vehicles = vehiclesToShow()
  const visibleIds = new Set(vehicles.map((vehicle) => String(vehicle.vehicleId)))

  vehicleMarkers.forEach((marker, id) => {
    if (!visibleIds.has(id)) {
      const activeAnimation = vehicleAnimations.get(id)
      if (activeAnimation) cancelAnimationFrame(activeAnimation)
      vehicleAnimations.delete(id)
      vehicleLayer.removeLayer(marker)
      vehicleMarkers.delete(id)
      vehiclePositions.delete(id)
    }
  })

  vehicles.forEach((vehicle) => {
    const id = String(vehicle.vehicleId)
    const next = L.latLng(vehicle.lat, vehicle.lon)
    const existing = vehicleMarkers.get(id)
    if (!existing) {
      const marker = L.marker(next, { icon: createVehicleIcon(vehicle), zIndexOffset: 500 })
        .bindTooltip(`${vehicle.transportType === 'tram' ? 'Tramm' : vehicle.transportType === 'trolley' ? 'Troll' : 'Buss'} ${vehicle.line}`)
        .addTo(vehicleLayer)
      vehicleMarkers.set(id, marker)
      vehiclePositions.set(id, next)
      return
    }

    existing.setIcon(createVehicleIcon(vehicle))
    const previous = vehiclePositions.get(id) || existing.getLatLng()
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
  const points = props.trip?.pathStops?.map((stop) => [stop.coordinates.lat, stop.coordinates.lon]) || []
  if (props.trip?.legs?.[0]?.vehicle) {
    const vehicle = props.trip.legs[0].vehicle
    points.push([vehicle.lat, vehicle.lon])
  }
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
  map = L.map(mapElement.value, { zoomControl: true }).setView([59.437, 24.7536], 13)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map)
  stopLayer = L.layerGroup().addTo(map)
  routeLayer = L.layerGroup().addTo(map)
  vehicleLayer = L.layerGroup().addTo(map)
  renderStops()
  renderRoute()
  updateVehicles()
  updateUserLocation()
  focusMap()
  window.setTimeout(() => map?.invalidateSize(), 100)
})

watch(() => props.vehicles, updateVehicles)
watch(() => props.trip, () => {
  renderRoute()
  updateVehicles()
  focusMap()
}, { deep: true })
watch(() => props.userLocation, updateUserLocation, { deep: true })

onUnmounted(() => {
  vehicleAnimations.forEach((frame) => cancelAnimationFrame(frame))
  map?.remove()
  map = null
})
</script>

<template>
  <div ref="mapElement" class="live-map" role="application" aria-label="Tallinna ühistranspordi kaart"></div>
</template>

<style>
.live-map { width: 100%; height: 390px; border: 1px solid #303832; border-radius: 12px; background: #d7ddd4; }
.vehicle-marker { border: 0; background: transparent; }
.vehicle-pin { position: relative; display: grid; width: 38px; height: 38px; place-items: center; border: 2px solid #101311; border-radius: 11px; color: #101311; background: var(--vehicle-color); box-shadow: 0 2px 8px #0008; }
.vehicle-line { position: relative; z-index: 1; font: 700 14px/1 'Segoe UI', Arial, sans-serif; }
.vehicle-arrow { position: absolute; top: -5px; left: 13px; width: 0; height: 0; border-right: 5px solid transparent; border-bottom: 10px solid #101311; border-left: 5px solid transparent; transform: rotate(var(--vehicle-heading)); transform-origin: 5px 24px; }
.leaflet-tooltip { font-family: 'Segoe UI', Arial, sans-serif; }
@media (max-width: 600px) {
  .live-map { height: 320px; }
}
</style>
