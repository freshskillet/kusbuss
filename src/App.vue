<script setup>
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import DepartureBoard from './components/DepartureBoard.vue'
import TripPlanner from './components/TripPlanner.vue'
import StopSelector from './components/StopSelector.vue'
import LiveMap from './components/LiveMap.vue'
import { getDeparturesAtStop } from './services/routePlanner'
import { loadTransitData } from './services/transitDataService'
import { getVehicles } from './services/transportService'

const REFRESH_INTERVAL = 10_000
const selectedStop = shallowRef(null)
const stops = shallowRef([])
const transitData = shallowRef(null)
const transitError = ref('')
const activeView = ref('planner')
const panelOpen = ref(true)
const panelElement = ref(null)
const mapMessage = ref('')
const vehicles = shallowRef([])
const dataSource = ref('loading')
const lastUpdated = ref(null)
const isLoading = ref(true)

const departures = computed(() => {
  if (activeView.value !== 'board' || !transitData.value || !selectedStop.value) return []
  return getDeparturesAtStop(
    transitData.value,
    selectedStop.value,
    new Date(),
    vehicles.value,
    12,
  )
})

async function refreshVehicles() {
  if (!stops.value.length) return
  try {
    const result = await getVehicles(stops.value)
    vehicles.value = result.vehicles
    dataSource.value = result.source
    lastUpdated.value = new Date()
  } catch (error) {
    console.error('Ühistranspordi andmete uuendamine ebaõnnestus:', error)
    dataSource.value = 'simulated'
  } finally {
    isLoading.value = false
  }
}

function selectStop(stop) {
  selectedStop.value = stop
}

function changeView() {
  panelOpen.value = true
  if (panelElement.value) panelElement.value.scrollTop = 0
}

const formattedUpdatedAt = computed(() => {
  if (!lastUpdated.value) return 'Andmeid laaditakse…'
  return new Intl.DateTimeFormat('et-EE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(lastUpdated.value)
})

let refreshTimer
onMounted(() => {
  loadTransitData()
    .then((data) => {
      transitData.value = data
      stops.value = data.stops
      selectedStop.value = data.stops.find((stop) => stop.name.toLocaleLowerCase('et').startsWith('vabaduse')) ||
        data.stops[0]
      return refreshVehicles()
    })
    .then(() => {
      refreshTimer = window.setInterval(refreshVehicles, REFRESH_INTERVAL)
    })
    .catch((error) => {
      console.error('Tallinna ametlike sõiduplaaniandmete laadimine ebaõnnestus:', error)
      transitError.value = 'Ametlikku sõiduplaani ei õnnestunud laadida. Proovi leht uuesti avada.'
      isLoading.value = false
    })
})
onUnmounted(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
})
</script>

<template>
  <main class="app-shell">
    <div class="map-backdrop">
      <LiveMap
        class="background-map"
        :stops="stops"
        :vehicles="dataSource === 'live' ? vehicles : []"
        satellite
        @map-error="mapMessage = $event"
      />
    </div>

    <header class="topbar">
      <a class="brand" href="#" aria-label="KusBuss avaleht">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none">
            <path d="M7 25V10.5A3.5 3.5 0 0 1 10.5 7h11a3.5 3.5 0 0 1 3.5 3.5V25" />
            <path d="M7 18h18M11 12h10M11 22h.01M21 22h.01M11 25v2m10-2v2" />
          </svg>
        </span>
        <span>Kus<span class="brand-accent">Buss</span></span>
      </a>
      <label class="view-picker">
        <span class="sr-only">Vali vaade</span>
        <select v-model="activeView" @change="changeView">
          <option value="planner">Reisiplaneerija</option>
          <option value="board">Peatuse tabloo</option>
        </select>
        <svg class="view-picker-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
      </label>
    </header>

    <div v-if="mapMessage" class="map-status" role="status">{{ mapMessage }}</div>

    <div class="panel-area">
      <button v-if="!panelOpen" class="open-panel" type="button" @click="panelOpen = true">
        {{ activeView === 'planner' ? 'Ava reisiplaneerija' : 'Ava peatuse tabloo' }} <span aria-hidden="true">⌃</span>
      </button>
      <div v-show="panelOpen" ref="panelElement" class="content-panel">
        <div class="panel-heading">
          <strong>{{ activeView === 'planner' ? 'Reisiplaneerija' : 'Peatuse tabloo' }}</strong>
          <button type="button" aria-label="Peida paneel" @click="panelOpen = false">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
          </button>
        </div>
        <p v-if="transitError" class="transit-state error-state" role="alert">{{ transitError }}</p>
        <p v-else-if="!transitData" class="transit-state">Laen ametlikke peatuste ja sõiduplaanide andmeid…</p>

        <template v-else-if="transitData">
      <div v-show="activeView === 'board' && selectedStop" class="content-grid">
        <aside class="sidebar">
          <StopSelector :stops="stops" :selected-stop-id="selectedStop.id" @select-stop="selectStop" />
        </aside>

        <section class="board-column" aria-live="polite">
          <div class="board-heading">
            <div>
              <div class="eyebrow board-eyebrow"><span class="eyebrow-line"></span>PEATUS</div>
              <h2>{{ selectedStop.name }}</h2>
              <p class="stop-direction">
                {{ selectedStop.area || selectedStop.authority }}
                <span v-if="selectedStop.platform"> · platvorm {{ selectedStop.platform }}</span>
                <span v-if="selectedStop.routes.length"> · {{ selectedStop.routes.slice(0, 2).map((route) => `${route.line} → ${route.destination}`).join(' · ') }}</span>
                <span v-if="selectedStop.wheelchairBoarding === '1'"> · ratastooliga ligipääsetav</span>
                <span v-else-if="selectedStop.wheelchairBoarding === '2'"> · ratastooliga ligipääsmatu</span>
              </p>
            </div>
            <div class="update-status" :class="{ 'is-simulated': dataSource === 'simulated' }">
              <span>{{ dataSource === 'simulated' ? 'DEMO GPS' : 'LIVE GPS' }}</span>
              <small>{{ formattedUpdatedAt }}</small>
            </div>
          </div>

          <DepartureBoard
            :departures="departures"
            :is-loading="isLoading"
            :stop-name="selectedStop.name"
          />

          <div class="board-footer">
            <div class="transport-legend">
              <span><i class="legend-dot bus"></i>Buss</span>
              <span><i class="legend-dot tram"></i>Tramm</span>
              <span><i class="legend-dot trolley"></i>Troll</span>
              <span><i class="legend-dot county"></i>Maakonnabuss</span>
            </div>
            <p>Uueneb automaatselt iga 10 sekundi järel</p>
          </div>
        </section>
      </div>

      <TripPlanner
        v-show="activeView === 'planner'"
        :data="transitData"
        :stops="stops"
        :vehicles="vehicles"
        :active="activeView === 'planner'"
      />
        </template>

    <footer class="page-footer">
      <a href="https://peatus.ee/content/Veebilehest%20ja%20%C3%BChistranspordi%20avaandmetest">Andmed: ühistranspordiregister / peatus.ee</a>
    </footer>
      </div>
    </div>
  </main>
</template>

<style>
:root {
  font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
  color: #f0f3ed;
  background: #111912;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-optical-sizing: auto;
  font-weight: 400;
  --surface: #1b241d;
  --surface-raised: #2b352d;
  --border: #435448;
  --muted: #a9b5aa;
  --green: #d7f6a8;
}

* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; background: #111912; }
button, input { font: inherit; }
button { color: inherit; }
a { color: inherit; text-decoration: none; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }

.app-shell { position: relative; isolation: isolate; height: 100vh; height: 100dvh; overflow: hidden; pointer-events: none; }
.map-backdrop { position: absolute; inset: 0; z-index: 0; pointer-events: auto; }
.map-backdrop .background-map { width: 100%; height: 100%; border: 0; border-radius: 0; }
.map-backdrop::after { position: absolute; inset: 0; z-index: 800; pointer-events: none; content: ''; box-shadow: inset 0 0 100px 25px #0a110cc7; backdrop-filter: blur(2px); mask-image: radial-gradient(ellipse at center, transparent 48%, #000 100%); }
.map-backdrop .leaflet-top.leaflet-left { top: 110px; }
.map-backdrop .leaflet-bottom.leaflet-right { bottom: env(safe-area-inset-bottom); }
.map-backdrop .leaflet-container .leaflet-control-attribution { padding: 3px 6px; border-radius: 6px 0 0 0; color: #e2ebe1; background: #172019ed; font-size: 10px; line-height: 1.35; text-align: right; }
.map-backdrop .leaflet-control-attribution a { color: #d7f6a8; }
.topbar { position: absolute; z-index: 2; top: max(16px, env(safe-area-inset-top)); right: 16px; left: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.topbar > * { pointer-events: auto; }
.brand { display: inline-flex; align-items: center; gap: 9px; padding: 5px 12px 5px 5px; border: 1px solid #71837388; border-radius: 999px; background: #18221cd9; backdrop-filter: blur(12px); font-family: inherit; font-size: 18px; font-weight: 700; letter-spacing: -0.5px; }
.brand-mark { display: grid; width: 40px; height: 40px; place-items: center; color: #1b2b1d; background: var(--green); border-radius: 50%; }
.brand-mark svg { width: 23px; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.brand-accent { color: var(--green); }
.view-picker { position: relative; display: flex; align-items: center; border: 1px solid #71837388; border-radius: 999px; background: #18221ce8; backdrop-filter: blur(12px); }
.view-picker select { min-height: 50px; max-width: 190px; padding: 0 38px 0 16px; appearance: none; border: 0; border-radius: inherit; color: #f0f3ed; background: transparent; cursor: pointer; font: inherit; font-size: 14px; }
.view-picker option { color: #f0f3ed; background: #1b251e; }
.view-picker-icon { position: absolute; top: 50%; right: 12px; width: 20px; height: 20px; transform: translateY(-50%); pointer-events: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
.map-status { position: absolute; z-index: 2; top: calc(max(16px, env(safe-area-inset-top)) + 58px); left: 16px; display: flex; max-width: min(380px, calc(100% - 32px)); flex-wrap: wrap; gap: 2px 8px; padding: 7px 10px; border: 1px solid #71837366; border-radius: 12px; color: #d8e3d6; background: #18221ce8; font-size: 12px; line-height: 1.4; }
.panel-area { position: absolute; z-index: 2; right: 0; bottom: 0; left: 0; display: flex; align-items: flex-end; justify-content: center; padding: 12px 16px calc(42px + env(safe-area-inset-bottom)); }
.content-panel { width: min(100%, 560px); max-height: calc(100vh - 210px); max-height: calc(100dvh - 210px); overflow: auto; padding: 14px; border: 1px solid #718373a6; border-radius: 26px; background: #172019ef; box-shadow: 0 14px 40px #000b; backdrop-filter: blur(18px); pointer-events: auto; overscroll-behavior: contain; }
.content-panel, .content-panel .suggestions, .content-panel .stop-list { scrollbar-width: thin; scrollbar-color: #748a76 transparent; }
.content-panel::-webkit-scrollbar, .content-panel .suggestions::-webkit-scrollbar, .content-panel .stop-list::-webkit-scrollbar { width: 7px; }
.content-panel::-webkit-scrollbar-thumb, .content-panel .suggestions::-webkit-scrollbar-thumb, .content-panel .stop-list::-webkit-scrollbar-thumb { border-radius: 999px; background: #748a76; }
.content-panel::-webkit-scrollbar-track, .content-panel .suggestions::-webkit-scrollbar-track, .content-panel .stop-list::-webkit-scrollbar-track { background: transparent; }
.panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 2px 10px; }
.panel-heading strong { font-size: 16px; }
.panel-heading button, .open-panel { min-height: 44px; border: 1px solid #71837388; border-radius: 999px; color: #e8f0e5; background: #304033; cursor: pointer; }
.panel-heading button { display: grid; width: 44px; height: 44px; place-items: center; padding: 0; }
.panel-heading button svg { width: 20px; height: 20px; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.open-panel { display: flex; width: min(100%, 560px); justify-content: space-between; align-items: center; padding: 0 20px; background: #172019ed; font-size: 15px; font-weight: 600; pointer-events: auto; }
.open-panel span { font-size: 20px; }
.transit-state { margin: 0; padding: 18px; border: 1px solid #343b35; border-radius: 10px; color: #d3dbd4; background: #171b18; }
.error-state { border-color: #9c3d3d; color: #ffc2bd; }

.eyebrow { display: flex; align-items: center; gap: 10px; color: var(--green); font-size: 11px; font-weight: 700; letter-spacing: 1.2px; }
.eyebrow-line { display: inline-block; width: 18px; height: 1px; background: var(--green); }

.content-grid { display: grid; gap: 20px; }
.board-column { min-width: 0; }
.board-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin: 3px 0 16px; }
.board-eyebrow { font-size: 10px; }
.board-heading h2 { margin: 10px 0 3px; font-family: inherit; font-size: 32px; letter-spacing: -.5px; }
.stop-direction { margin: 0; color: var(--muted); font-size: 14px; }
.update-status { display: grid; grid-template-columns: auto; align-items: center; padding-bottom: 3px; color: #a8c987; font-size: 11px; font-weight: 700; letter-spacing: .7px; white-space: nowrap; }
.update-status small { grid-column: 1; margin-top: 5px; color: #929a94; font-size: 12px; font-weight: 400; letter-spacing: 0; }
.is-simulated { color: #e7bd72; }
.board-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 15px; color: #929a94; font-size: 12px; }
.board-footer p { margin: 0; }
.transport-legend { display: flex; flex-wrap: wrap; gap: 13px; }
.transport-legend span { display: inline-flex; align-items: center; gap: 5px; }
.legend-dot { width: 6px; height: 6px; border-radius: 50%; }
.legend-dot.bus { background: #00c99a; }
.legend-dot.tram { background: #ff642e; }
.legend-dot.trolley { background: #174d9b; }
.legend-dot.county { background: #ffbf80; }
.page-footer { padding: 16px 4px 2px; color: #b7c3b6; font-size: 12px; }
.page-footer a { color: inherit; }

@media (max-width: 380px) {
  .topbar { right: 10px; left: 10px; }
  .view-picker select { max-width: 160px; padding-left: 12px; font-size: 13px; }
  .panel-area { padding-right: 10px; padding-left: 10px; }
  .content-panel { padding: 10px; }
  .board-heading h2 { font-size: 25px; }
  .update-status { font-size: 10px; }
  .update-status small { font-size: 11px; }
  .board-footer { align-items: flex-start; flex-direction: column; }
}
</style>
