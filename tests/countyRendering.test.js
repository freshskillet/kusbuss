import test from 'node:test'
import assert from 'node:assert/strict'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

test('renders county departures and planner cards with the county appearance', async (t) => {
  const server = await createServer({
    configFile: false,
    plugins: [{
      name: 'stub-leaflet-map',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source === './LiveMap.vue' && importer?.endsWith('TripPlanner.vue')) return '\0test-map'
      },
      load(id) {
        if (id === '\0test-map') return 'export default { render: () => null }'
      },
    }, vue()],
    server: { middlewareMode: true },
    appType: 'custom',
  })
  t.after(() => server.close())

  const { default: DepartureBoard } = await server.ssrLoadModule('/src/components/DepartureBoard.vue')
  const board = await renderToString(createSSRApp(DepartureBoard, {
    stopName: 'Kiili',
    departures: [{
      id: 'county-116', line: '116', transportType: 'county', destination: 'Viru',
      minutes: 5, scheduledAt: new Date(), isLive: false, estimatedDelayMinutes: null,
    }],
  }))
  assert.match(board, /class="(?=[^"]*\broute-number\b)(?=[^"]*\bcounty\b)[^"]*"/)
  assert.match(board, /MAAKONNA SÕIDUPLAAN/)
  assert.doesNotMatch(board, /LIVE GPS · HINNANG/)

  const { default: TripPlanner } = await server.ssrLoadModule('/src/components/TripPlanner.vue')
  const origin = {
    id: 'from', name: 'Vabaduse väljak', coordinates: { lat: 59.43, lon: 24.75 },
    routes: [], transferOptions: [],
  }
  const destination = {
    id: 'to', name: 'Ülemiste jaam', coordinates: { lat: 59.44, lon: 24.78 },
    routes: [], transferOptions: [],
  }
  const now = new Date()
  const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + 300
  const trip = {
    id: 'county-trip', serviceIndex: 0,
    route: { id: 'county-116', number: '116', type: 'county', name: 'Ülemiste jaam', destination: 'Ülemiste jaam' },
    stopTimes: [
      { stop: origin, arrivalSeconds: seconds, departureSeconds: seconds, pickupType: '0' },
      { stop: destination, arrivalSeconds: seconds + 600, departureSeconds: seconds + 600, dropOffType: '0' },
    ],
  }
  const data = {
    source: { endDate: '20991231' }, stops: [origin, destination], trips: [trip],
    services: [{ start: '20200101', end: '20991231', weekdays: [true, true, true, true, true, true, true] }],
    exceptions: [],
  }
  const planner = await renderToString(createSSRApp(TripPlanner, { data, stops: data.stops, vehicles: [] }))
  assert.match(planner, /class="(?=[^"]*\broute-line-chip\b)(?=[^"]*\bcounty\b)[^"]*"/)
  assert.match(planner, /Liin 116/)
})
