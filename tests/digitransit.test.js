import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { decodePolyline, fetchItineraries } from '../src/services/digitransit.js'
import viteConfig from '../vite.config.js'

const request = {
  from: { lat: 59.44, lon: 24.74, name: 'Balti jaam' },
  to: { lat: 59.31, lon: 24.84, name: 'Kiili' },
  at: new Date('2026-11-25T10:00:00+02:00'),
  searchMode: 'depart',
}

test('requests raw itineraries with variables for departure and arrival', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const node = { legs: [{ mode: 'BUS', stopCalls: [{ stopLocation: { name: 'Kiili' } }] }] }
  const signal = new AbortController().signal
  let captured
  globalThis.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) }
    return { ok: true, json: async () => ({ data: { planConnection: { edges: [{ node }], routingErrors: [] } } }) }
  }

  assert.deepEqual(await fetchItineraries({ ...request, signal }), [node])
  assert.equal(captured.url, '/api/digitransit')
  assert.equal(captured.options.method, 'POST')
  assert.deepEqual(captured.options.headers, { 'Content-Type': 'application/json' })
  assert.equal(captured.options.signal, signal)
  assert.deepEqual(captured.body.variables, {
    origin: { label: 'Balti jaam', location: { coordinate: { latitude: 59.44, longitude: 24.74 } } },
    destination: { label: 'Kiili', location: { coordinate: { latitude: 59.31, longitude: 24.84 } } },
    dateTime: { earliestDeparture: '2026-11-25T08:00:00.000Z' },
    first: 5,
  })
  assert.match(captured.body.query, /planConnection/)
  assert.match(captured.body.query, /stopCalls/)
  await fetchItineraries({ ...request, searchMode: 'arrive' })
  assert.deepEqual(captured.body.variables.dateTime, { latestArrival: '2026-11-25T08:00:00.000Z' })
  assert.equal(captured.body.variables.last, 5)
  assert.ok(!('first' in captured.body.variables))
})

test('distinguishes empty plans, routing, GraphQL, HTTP and abort errors', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const reply = (data) => { globalThis.fetch = async () => ({ ok: true, json: async () => data }) }
  reply({ data: { planConnection: { edges: [], routingErrors: [] } } })
  assert.deepEqual(await fetchItineraries(request), [])
  const routingErrors = [{ code: 'NO_TRANSIT_CONNECTION', description: 'No route', inputField: null }]
  reply({ data: { planConnection: { edges: null, routingErrors } } })
  await assert.rejects(fetchItineraries(request), (error) => error.routingErrors === routingErrors)
  const graphQLErrors = [{ message: 'Bad query', extensions: { classification: 'ValidationError' } }]
  reply({ errors: graphQLErrors, data: { planConnection: { edges: [], routingErrors: [] } } })
  await assert.rejects(fetchItineraries(request), (error) => error.graphQLErrors === graphQLErrors)
  reply({ data: { planConnection: { edges: null, routingErrors: [] } } })
  await assert.rejects(fetchItineraries(request), /Invalid Digitransit response/)
  globalThis.fetch = async () => ({ ok: false, status: 401 })
  await assert.rejects(fetchItineraries(request), (error) => error.status === 401)
  const abort = new DOMException('Aborted', 'AbortError')
  globalThis.fetch = async () => { throw abort }
  await assert.rejects(fetchItineraries(request), (error) => error === abort)
  await assert.rejects(fetchItineraries({ ...request, at: new Date('invalid') }), /Invalid date/)
  await assert.rejects(fetchItineraries({ ...request, searchMode: 'other' }), /Invalid search mode/)
  await assert.rejects(fetchItineraries({ ...request, from: { lat: 91, lon: 0 } }), /Invalid coordinates/)
})

test('decodes polyline and rejects malformed encodings', () => {
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [
    { lat: 38.5, lon: -120.2 },
    { lat: 40.7, lon: -120.95 },
    { lat: 43.252, lon: -126.453 },
  ])
  assert.deepEqual(decodePolyline(''), [])
  for (const value of [null, '?', '_', '?_', ' !', '______?', '_??', '~~~~~~~?']) {
    assert.throws(() => decodePolyline(value))
  }
})

test('proxy inserts only server-side subscription key', (t) => {
  const previous = process.env.DIGITRANSIT_SUBSCRIPTION_KEY
  t.after(() => {
    if (previous === undefined) delete process.env.DIGITRANSIT_SUBSCRIPTION_KEY
    else process.env.DIGITRANSIT_SUBSCRIPTION_KEY = previous
  })
  process.env.DIGITRANSIT_SUBSCRIPTION_KEY = 'test-key'
  const config = viteConfig({ mode: 'development' })
  const proxyConfig = config.server.proxy['/api/digitransit']
  assert.equal(proxyConfig.target, 'https://api.digitransit.fi/routing/v2/finland/gtfs/v1')
  assert.equal(proxyConfig.rewrite('/api/digitransit'), '')
  const proxy = new EventEmitter()
  proxyConfig.configure(proxy)
  const headers = { 'digitransit-subscription-key': 'client-key' }
  proxy.emit('proxyReq', {
    removeHeader: (name) => { delete headers[name] },
    setHeader: (name, value) => { headers[name] = value },
  })
  assert.deepEqual(headers, { 'digitransit-subscription-key': 'test-key' })
})
