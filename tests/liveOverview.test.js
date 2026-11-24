import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, shallowRef, ssrContextKey } from 'vue'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

test('overview shows vehicles in the viewport and falls back when imagery fails', async (t) => {
  const events = {}
  const tileLayers = []
  const markers = []
  const warnings = []
  let maxLatitude = 2
  let zoom = 13
  const map = {
    setView() { return this },
    getZoom: () => zoom,
    getBounds: () => ({ contains: ({ lat }) => lat <= maxLatitude }),
    on(name, callback) { events[name] = callback },
    removeLayer(layer) { layer.removed = true },
    invalidateSize() {},
    remove() {},
  }
  const layer = () => ({
    addTo() { return this },
    bindTooltip() { return this },
    clearLayers() {},
    removeLayer(marker) { marker.removed = true },
  })
  const saved = {
    leaflet: globalThis.__testOverviewLeaflet,
    ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  }
  globalThis.__testOverviewLeaflet = {
    map: () => map,
    tileLayer(url, options) {
      const tiles = { ...layer(), url, options, once(name, callback) { this[name] = callback } }
      tileLayers.push(tiles)
      return tiles
    },
    layerGroup: layer,
    marker(point, options) {
      const marker = {
        ...layer(), point, icon: options.icon, icons: 0,
        setIcon(icon) { this.icon = icon; this.icons++ },
        setLatLng() {},
      }
      markers.push(marker)
      return marker
    },
    divIcon: (options) => options,
    latLng: (lat, lng) => ({ lat, lng }),
  }
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  globalThis.requestAnimationFrame = () => 1
  globalThis.cancelAnimationFrame = () => {}

  const server = await createServer({
    configFile: false,
    plugins: [{
      name: 'stub-overview-leaflet',
      enforce: 'pre',
      resolveId(source) {
        if (source === 'leaflet') return '\0overview-leaflet'
        if (source === 'leaflet/dist/leaflet.css') return '\0overview-css'
      },
      load(id) {
        if (id === '\0overview-leaflet') return 'export default globalThis.__testOverviewLeaflet'
        if (id === '\0overview-css') return ''
      },
    }, vue()],
    ssr: { noExternal: ['leaflet'] },
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  })
  let app
  t.after(async () => {
    app?.unmount()
    await server.close()
    globalThis.__testOverviewLeaflet = saved.leaflet
    globalThis.ResizeObserver = saved.ResizeObserver
    globalThis.requestAnimationFrame = saved.requestAnimationFrame
    globalThis.cancelAnimationFrame = saved.cancelAnimationFrame
  })
  const { default: LiveMap } = await server.ssrLoadModule('/src/components/LiveMap.vue')
  const source = await readFile(new URL('../src/components/LiveMap.vue', import.meta.url), 'utf8')
  const descriptor = parse(source).descriptor
  const bindings = compileScript(descriptor, { id: 'overview-test' }).bindings
  const template = compileTemplate({
    source: descriptor.template.content, filename: 'LiveMap.vue', id: 'overview-test',
    compilerOptions: { mode: 'function', prefixIdentifiers: true, bindingMetadata: bindings },
  })
  assert.deepEqual(template.errors, [])
  LiveMap.render = new Function('Vue', template.code)(Vue)
  const renderer = createRenderer({
    createElement: (type) => ({ type, children: [] }),
    createText: (text) => ({ text }),
    createComment: (text) => ({ text }),
    setText(node, text) { node.text = text },
    setElementText(node, text) { node.text = text },
    patchProp() {},
    insert(node, parent) { parent.children.push(node) },
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const first = { line: '1', vehicleId: 'a', transportType: 'bus', lat: 1, lon: 1, heading: 0 }
  const second = { ...first, vehicleId: 'b', lat: 3 }
  const vehicles = shallowRef([first, second])
  app = renderer.createApp({
    render: () => h(LiveMap, {
      stops: [], satellite: true, vehicles: vehicles.value,
      onMapError: (message) => warnings.push(message),
    }),
  })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount({ children: [] })
  await nextTick()
  assert.match(tileLayers[0].url, /World_Imagery/)
  assert.equal(markers.length, 1)
  assert.match(markers[0].icon.html, /vehicle-dot/)
  assert.doesNotMatch(markers[0].icon.html, /vehicle-line/)

  vehicles.value = [{ ...first }, second]
  await nextTick()
  assert.equal(markers[0].icons, 0)
  zoom = 15
  events.moveend()
  assert.match(markers[0].icon.html, /vehicle-line/)
  zoom = 13
  events.moveend()
  assert.match(markers[0].icon.html, /vehicle-dot/)
  maxLatitude = 4
  events.moveend()
  assert.equal(markers.length, 2)
  maxLatitude = 0
  events.moveend()
  assert.ok(markers.every((marker) => marker.removed))

  tileLayers[0].tileerror()
  assert.equal(tileLayers[0].removed, true)
  assert.match(tileLayers[1].url, /openstreetmap/)
  assert.match(warnings[0], /Satelliidipilt pole saadaval/)
})
