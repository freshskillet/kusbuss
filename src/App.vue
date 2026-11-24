<script setup>
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import DepartureBoard from './components/DepartureBoard.vue'
import TripPlanner from './components/TripPlanner.vue'
import StopSelector from './components/StopSelector.vue'
import { getDeparturesAtStop } from './services/routePlanner'
import { loadTransitData } from './services/transitDataService'
import { getVehicles } from './services/transportService'

const REFRESH_INTERVAL = 10_000
const selectedStop = shallowRef(null)
const stops = shallowRef([])
const transitData = shallowRef(null)
const transitError = ref('')
const activeView = ref('planner')
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
      <div class="topbar-note"><span class="city-dot"></span>Tallinn, Eesti</div>
    </header>

    <nav class="view-tabs" aria-label="Rakenduse vaade">
      <button
        type="button"
        :class="{ active: activeView === 'planner' }"
        :aria-current="activeView === 'planner' ? 'page' : undefined"
        @click="activeView = 'planner'"
      >Reisiplaneerija</button>
      <button
        type="button"
        :class="{ active: activeView === 'board' }"
        :aria-current="activeView === 'board' ? 'page' : undefined"
        @click="activeView = 'board'"
      >Peatuse tabloo</button>
    </nav>

    <p v-if="transitError" class="transit-state error-state" role="alert">{{ transitError }}</p>
    <p v-else-if="!transitData" class="transit-state">Laen ametlikke peatuste ja sõiduplaanide andmeid…</p>

    <template v-else-if="transitData">
      <div v-show="activeView === 'board' && selectedStop" class="content-grid">
        <aside class="sidebar">
          <StopSelector :stops="stops" :selected-stop-id="selectedStop.id" @select-stop="selectStop" />
          <div class="sidebar-tip">
            <span class="tip-icon" aria-hidden="true">✦</span>
            <p>Lisa peatus lemmikuks, et leida see järgmisel korral kiiremini.</p>
          </div>
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
      />
    </template>

    <footer class="page-footer">
      <span>Liigu linnas omas rütmis.</span>
      <a href="https://peatus.ee/content/Veebilehest%20ja%20%C3%BChistranspordi%20avaandmetest">Andmed: ühistranspordiregister / peatus.ee</a>
      <span>KusBuss <span class="footer-divider">/</span> Tallinn</span>
    </footer>
  </main>
</template>

<style>
:root {
  font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
  color: #f5f7f5;
  background: #101311;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-optical-sizing: auto;
  font-weight: 400;
  --surface: #171b18;
  --surface-raised: #1c211e;
  --border: #2a302c;
  --muted: #929a94;
  --green: #b7f36b;
}

* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; min-height: 100vh; }
button, input { font: inherit; }
button { color: inherit; }
a { color: inherit; text-decoration: none; }

.app-shell {
  width: min(1120px, calc(100% - 48px));
  min-height: 100vh;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}

.topbar {
  height: 82px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #252a26;
}
.brand { display: inline-flex; align-items: center; gap: 10px; font-family: inherit; font-size: 19px; font-weight: 800; letter-spacing: -0.8px; }
.brand-mark { display: grid; width: 34px; height: 34px; place-items: center; color: #101311; background: var(--green); border-radius: 11px; }
.brand-mark svg { width: 23px; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.brand-accent { color: var(--green); }
.topbar-note { display: flex; align-items: center; gap: 8px; color: #a7afa9; font-size: 14px; }
.city-dot { width: 6px; height: 6px; background: var(--green); border-radius: 50%; }
.view-tabs { display: flex; gap: 5px; width: fit-content; margin-top: 20px; padding: 4px; border: 1px solid #2a302c; border-radius: 10px; background: #171b18; }
.view-tabs button { padding: 9px 14px; border: 0; border-radius: 7px; color: #a2aaa3; background: transparent; cursor: pointer; font-size: 13px; font-weight: 600; }
.view-tabs button:hover { color: #f5f7f5; }
.view-tabs button.active { color: #d7efc5; background: #293325; }
.transit-state { margin: 28px 0; padding: 18px; border: 1px solid #343b35; border-radius: 10px; color: #d3dbd4; background: #171b18; }
.error-state { border-color: #9c3d3d; color: #ffc2bd; }

.eyebrow { display: flex; align-items: center; gap: 10px; color: var(--green); font-size: 11px; font-weight: 700; letter-spacing: 1.2px; }
.eyebrow-line { display: inline-block; width: 18px; height: 1px; background: var(--green); }

.content-grid { display: grid; grid-template-columns: 330px minmax(0, 1fr); align-items: start; gap: 48px; margin-top: 38px; }
.sidebar { display: flex; flex-direction: column; gap: 18px; }
.sidebar-tip { display: flex; align-items: flex-start; gap: 10px; padding: 16px; border: 1px solid #292f2b; border-radius: 14px; background: #151916; }
.tip-icon { color: var(--green); font-size: 15px; }
.sidebar-tip p { margin: 0; color: #99a19a; font-size: 13px; line-height: 1.6; }
.board-column { min-width: 0; }
.board-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin: 3px 0 23px; }
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
.page-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-top: auto; padding: 32px 0 24px; color: #929a94; font-size: 12px; }
.page-footer a { color: inherit; }
.footer-divider { padding: 0 5px; color: #424a44; }

@media (max-width: 760px) {
  .app-shell { width: min(100% - 36px, 540px); }
  .topbar { height: 68px; }
  .view-tabs { margin-top: 14px; }
  .view-tabs button { padding: 8px 11px; font-size: 12px; }
  .content-grid { grid-template-columns: 1fr; gap: 30px; }
  .sidebar { gap: 12px; }
  .sidebar-tip { display: none; }
  .board-heading { margin-top: 0; }
  .page-footer { padding-top: 38px; }
}

@media (max-width: 380px) {
  .app-shell { width: calc(100% - 28px); }
  .board-heading h2 { font-size: 25px; }
  .update-status { font-size: 10px; }
  .update-status small { font-size: 11px; }
  .board-footer { align-items: flex-start; flex-direction: column; }
}
</style>
