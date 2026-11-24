import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, shallowRef, ssrContextKey } from 'vue'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

function testRenderer() {
  const renderer = createRenderer({
    createElement: (type) => ({ type, props: {}, style: {}, children: [] }),
    createText: (text) => ({ type: '#text', text }),
    createComment: (text) => ({ type: '#comment', text }),
    setText: (node, text) => { node.text = text },
    setElementText: (node, text) => { node.text = text; node.children = [] },
    patchProp: (node, key, previous, next) => { node.props[key] = next },
    insert(node, parent, anchor) {
      if (node.parent) {
        const oldIndex = node.parent.children.indexOf(node)
        if (oldIndex >= 0) node.parent.children.splice(oldIndex, 1)
      }
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(node)
      else parent.children.splice(index, 0, node)
    },
    remove(node) {
      const index = node.parent?.children.indexOf(node) ?? -1
      if (index >= 0) node.parent.children.splice(index, 1)
      node.parent = null
    },
    parentNode: (node) => node.parent,
    nextSibling(node) {
      const siblings = node.parent?.children || []
      return siblings[siblings.indexOf(node) + 1] || null
    },
  })
  return renderer
}

function descendants(node) {
  return [node, ...(node.children || []).flatMap(descendants)]
}

test('opening a trip pins its vehicle across GPS refresh and temporary loss', async (t) => {
  const server = await createServer({
    configFile: false,
    plugins: [{
      name: 'stub-leaflet-map',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source === './LiveMap.vue' && importer?.endsWith('TripPlanner.vue')) return '\0tracking-map'
        if (source === './StopSearch.vue' && importer?.endsWith('TripPlanner.vue')) return '\0stop-search'
        if (source === '../services/digitransit' && importer?.endsWith('TripPlanner.vue')) return '\0routing-api'
      },
      load(id) {
        if (id === '\0tracking-map') return "import { h } from 'vue'; export default { props: ['trip'], render() { return h('div', { 'data-vehicle': this.trip?.legs[0]?.vehicle?.vehicleId || '' }) } }"
        if (id === '\0stop-search') return "import { h } from 'vue'; export default { render() { return h('input') } }"
        if (id === '\0routing-api') return 'export const fetchItineraries = async () => globalThis.__testItineraries'
      },
    }, vue()],
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  })
  t.after(() => server.close())
  const { default: TripPlanner } = await server.ssrLoadModule('/src/components/TripPlanner.vue')
  const source = await readFile(new URL('../src/components/TripPlanner.vue', import.meta.url), 'utf8')
  const descriptor = parse(source).descriptor
  const bindings = compileScript(descriptor, { id: 'tracking-test' }).bindings
  const template = compileTemplate({
    source: descriptor.template.content, filename: 'TripPlanner.vue', id: 'tracking-test',
    compilerOptions: { mode: 'function', prefixIdentifiers: true, bindingMetadata: bindings },
  })
  assert.deepEqual(template.errors, [])
  TripPlanner.render = new Function('Vue', template.code)({ ...Vue, vModelText: {} })
  const origin = { id: 'origin', name: 'Vabaduse väljak', coordinates: { lat: 59.31, lon: 24.75 }, routes: [] }
  const destination = { id: 'destination', name: 'Ülemiste jaam', coordinates: { lat: 59.32, lon: 24.75 }, routes: [] }
  const route = { id: 'city', number: '2', type: 'bus', name: 'Ülemiste jaam', destination: 'Ülemiste jaam' }
  const shape = { points: [
    { lat: 59.28, lon: 24.75, distance: 0 },
    { lat: 59.31, lon: 24.75, distance: 3336 },
    { lat: 59.32, lon: 24.75, distance: 4448 },
  ] }
  const now = new Date()
  const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
  const trip = (id, departureSeconds) => ({
    id, route, direction: '0', serviceIndex: 0, shape,
    stopTimes: [
      { stop: origin, arrivalSeconds: departureSeconds, departureSeconds, shapeDistance: 3336, pickupType: '0' },
      { stop: destination, arrivalSeconds: departureSeconds + 600, departureSeconds: departureSeconds + 600, shapeDistance: 4448, dropOffType: '0' },
    ],
  })
  const data = {
    source: { endDate: '20991231' }, stops: [origin, destination],
    routes: [{ id: 'county:harjumaa116', number: '116', type: 'county', name: 'Tallinn - Kiili' }],
    trips: [trip('earlier', seconds + 60), trip('selected', seconds + 240)],
    services: [{ start: '20200101', end: '20991231', weekdays: [true, true, true, true, true, true, true] }],
    exceptions: [],
  }
  const place = (stop) => ({
    name: stop.name, lat: stop.coordinates.lat, lon: stop.coordinates.lon,
    stop: { gtfsId: `api:${stop.id}`, name: stop.name, ...stop.coordinates },
  })
  const tripForApi = (id, dep) => {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, dep)
    const end = new Date(start.getTime() + 600_000)
    return {
      start: start.toISOString(), end: end.toISOString(),
      legs: [{
        id, mode: 'BUS', transitLeg: true, serviceDate: 'today', duration: 600, distance: 1000,
        from: place(origin), to: place(destination), start: { scheduledTime: start.toISOString() },
        end: { scheduledTime: end.toISOString() }, route: { gtfsId: 'api:city', shortName: '2', longName: 'Ülemiste jaam' },
        trip: { gtfsId: `api:${id}` }, headsign: 'Ülemiste jaam',
      }],
    }
  }
  const oldItineraries = globalThis.__testItineraries
  const county = tripForApi('county', seconds + 600)
  county.legs[0].route = { gtfsId: 'api:county', shortName: '116', longName: 'Tallinn - Kiili' }
  globalThis.__testItineraries = [tripForApi('earlier', seconds + 60), tripForApi('selected', seconds + 240), county]
  t.after(() => { globalThis.__testItineraries = oldItineraries })
  const earlier = { line: '2', transportType: 'bus', vehicleId: 'earlier', lat: 59.308, lon: 24.75, heading: 0, speed: 18 }
  const selected = { ...earlier, vehicleId: 'selected', lat: 59.299 }
  const vehicles = shallowRef([earlier, selected])
  const root = { type: 'root', children: [] }
  const app = testRenderer().createApp({ render: () => h(TripPlanner, { data, stops: data.stops, vehicles: vehicles.value }) })
  app.provide(ssrContextKey, { modules: new Set() })
  t.after(() => app.unmount())
  app.mount(root)
  await nextTick()
  descendants(root).find((node) => node.props?.class === 'search-toggle').props.onClick()
  await nextTick()
  await nextTick()
  const cards = descendants(root).filter((node) => node.type === 'button' && node.props.class === 'trip-card')
  assert.equal(cards.length, 3)
  assert.ok(descendants(root).some((node) =>
    typeof node.props?.class === 'string' && node.props.class.includes('route-line-chip') && node.props.class.includes('county'),
  ))
  cards[1].props.onClick()
  await nextTick()
  const nodes = descendants(root)
  assert.equal(nodes.some((node) => node.props?.class === 'trip-card-status'), false)
  assert.equal(nodes.some((node) => node.props?.class === 'step-map-icon'), false)
  const stops = nodes.filter((node) => node.props?.class === 'step-copy' && node.children?.some((child) => child.type === 'strong'))
  assert.ok(stops.length >= 2)
  assert.ok(stops.every((stop) => !stop.children.some((child) => child.type === 'small')))
  assert.ok(nodes.some((node) => node.props?.class === 'leg-live-info'))
  const mapVehicle = () => descendants(root).find((node) => node.props?.['data-vehicle'] !== undefined)?.props['data-vehicle']
  assert.equal(mapVehicle(), 'selected')
  vehicles.value = [earlier, { ...selected, lat: 59.302 }]
  await nextTick()
  assert.equal(mapVehicle(), 'selected')
  vehicles.value = [earlier]
  await nextTick()
  assert.equal(mapVehicle(), '')
  vehicles.value = [earlier, selected]
  await nextTick()
  assert.equal(mapVehicle(), 'selected')
  cards[1].props.onClick()
  vehicles.value = [earlier]
  await nextTick()
  cards[1].props.onClick()
  await nextTick()
  assert.equal(mapVehicle(), '')
  vehicles.value = [earlier, selected]
  await nextTick()
  await nextTick()
  assert.equal(mapVehicle(), 'selected')
  vehicles.value = [earlier, { ...selected, vehicleId: 'replacement' }]
  await nextTick()
  assert.equal(mapVehicle(), '')
  cards[1].props.onClick()
  await nextTick()
  cards[1].props.onClick()
  await nextTick()
  assert.equal(mapVehicle(), 'replacement')
})

test('focuses newly matched vehicles, including a transfer, without refocusing on every refresh', async (t) => {
  const fits = []
  const markers = []
  let bounds = { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 }
  const map = {
    setView() { return this },
    fitBounds(points) {
      fits.push(points.map((point) => [...point]))
      bounds = {
        minLat: Math.min(...points.map((point) => point[0])),
        maxLat: Math.max(...points.map((point) => point[0])),
        minLon: Math.min(...points.map((point) => point[1])),
        maxLon: Math.max(...points.map((point) => point[1])),
      }
    },
    getBounds() {
      return { contains: ({ lat, lng }) =>
        lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLon && lng <= bounds.maxLon }
    },
    invalidateSize() {},
    remove() {},
  }
  const layer = () => ({
    addTo() { return this },
    bindTooltip() { return this },
    clearLayers() {},
    removeLayer() {},
    setIcon() {},
    setLatLng() {},
  })
  const oldLeaflet = globalThis.__testLeaflet
  const oldResizeObserver = globalThis.ResizeObserver
  const oldRequestAnimationFrame = globalThis.requestAnimationFrame
  const oldCancelAnimationFrame = globalThis.cancelAnimationFrame
  let app
  let server
  globalThis.__testLeaflet = {
    map: () => map,
    tileLayer: layer,
    layerGroup: layer,
    circleMarker: layer,
    polyline: layer,
    marker(point) { markers.push(point); return layer() },
    divIcon: (options) => options,
    latLng: (lat, lng) => ({ lat, lng }),
    latLngBounds: (points) => points,
  }
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  globalThis.requestAnimationFrame = () => 1
  globalThis.cancelAnimationFrame = () => {}
  t.after(async () => {
    if (app) app.unmount()
    if (server) await server.close()
    globalThis.__testLeaflet = oldLeaflet
    globalThis.ResizeObserver = oldResizeObserver
    globalThis.requestAnimationFrame = oldRequestAnimationFrame
    globalThis.cancelAnimationFrame = oldCancelAnimationFrame
  })

  server = await createServer({
    configFile: false,
    plugins: [{
      name: 'stub-leaflet',
      enforce: 'pre',
      resolveId(source) {
        if (source === 'leaflet') return '\0tracking-leaflet'
        if (source === 'leaflet/dist/leaflet.css') return '\0tracking-css'
      },
      load(id) {
        if (id === '\0tracking-leaflet') return 'export default globalThis.__testLeaflet'
        if (id === '\0tracking-css') return ''
      },
    }, vue()],
    ssr: { noExternal: ['leaflet'] },
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  })
  const { default: LiveMap } = await server.ssrLoadModule('/src/components/LiveMap.vue')
  const source = await readFile(new URL('../src/components/LiveMap.vue', import.meta.url), 'utf8')
  const descriptor = parse(source).descriptor
  const bindings = compileScript(descriptor, { id: 'map-test' }).bindings
  const template = compileTemplate({
    source: descriptor.template.content, filename: 'LiveMap.vue', id: 'map-test',
    compilerOptions: { mode: 'function', prefixIdentifiers: true, bindingMetadata: bindings },
  })
  assert.deepEqual(template.errors, [])
  LiveMap.render = new Function('Vue', template.code)(Vue)

  const first = { trackingKey: 'first', line: '36', transportType: 'bus', vehicle: null, shapePoints: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }], pathStops: [] }
  const second = { trackingKey: 'second', line: '2', transportType: 'bus', vehicle: null, shapePoints: [{ lat: 2, lon: 2 }, { lat: 3, lon: 3 }], pathStops: [] }
  const trip = shallowRef({ id: 'trip', departsAt: new Date(), legs: [first, second] })
  const vehicles = shallowRef([])
  app = testRenderer().createApp({ render: () => h(LiveMap, { trip: trip.value, stops: [], vehicles: vehicles.value }) })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount({ type: 'root', children: [] })
  await nextTick()
  assert.equal(fits.length, 1)
  const bus = { vehicleId: 'a', line: '36', transportType: 'bus', lat: 0, lon: 0, heading: 0 }
  vehicles.value = [bus]
  await nextTick()
  assert.equal(markers.length, 0)
  trip.value = { ...trip.value, legs: [{ ...first, vehicle: bus }, second] }
  await nextTick()
  assert.equal(markers.length, 1)
  assert.ok(fits.at(-1).some(([lat, lon]) => lat === 0 && lon === 0))

  const transferBus = { vehicleId: 'b', line: '2', transportType: 'bus', lat: 4, lon: 4, heading: 0 }
  vehicles.value = [bus, transferBus]
  trip.value = { ...trip.value, legs: [{ ...first, vehicle: bus }, { ...second, vehicle: transferBus }] }
  await nextTick()
  assert.equal(markers.length, 2)
  assert.ok(fits.at(-1).some(([lat, lon]) => lat === 0 && lon === 0))
  assert.ok(fits.at(-1).some(([lat, lon]) => lat === 4 && lon === 4))
  const fitCount = fits.length
  vehicles.value = [{ ...bus, lat: -0.1 }, { ...transferBus, lat: 4.1 }]
  await nextTick()
  assert.equal(fits.length, fitCount)
})
