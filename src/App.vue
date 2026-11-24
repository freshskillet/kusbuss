<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import DepartureBoard from './components/DepartureBoard.vue'
import TripPlanner from './components/TripPlanner.vue'
import StopSelector from './components/StopSelector.vue'
import { stops, transitLines } from './data/stops'
import { getVehicles } from './services/transportService'
import { calculateArrivalMinutes, distanceBetween, isHeadingTowardStop } from './utils/etaCalculator'

const REFRESH_INTERVAL = 10_000
const selectedStop = ref(stops[0])
const activeView = ref('planner')
const vehicles = ref([])
const dataSource = ref('loading')
const lastUpdated = ref(null)
const isLoading = ref(true)

const departures = computed(() => {
  const stop = selectedStop.value
  if (!stop) return []

  return stop.routes.map((route, index) => {
    const matches = vehicles.value
      .filter((vehicle) => vehicle.line.toLowerCase() === route.line.toLowerCase())
      .filter((vehicle) => vehicle.transportType === route.transportType)
      .filter((vehicle) => isHeadingTowardStop(vehicle, stop.coordinates))
      .map((vehicle) => ({
        vehicle,
        distance: distanceBetween(stop.coordinates, {
          lat: vehicle.lat,
          lon: vehicle.lon,
        }),
      }))
      .filter(({ distance }) => distance <= 3000)
      .sort((a, b) => a.distance - b.distance)

    const nearest = matches[0]
    if (nearest) {
      return {
        id: `${stop.id}-${route.line}-${nearest.vehicle.vehicleId}`,
        line: route.line,
        transportType: route.transportType,
        destination: route.destination,
        minutes: calculateArrivalMinutes(
          stop.coordinates,
          { lat: nearest.vehicle.lat, lon: nearest.vehicle.lon },
          nearest.vehicle.speed,
        ),
        isLive: true,
        isSimulated: nearest.vehicle.isSimulated,
        distance: nearest.distance,
        vehicleId: nearest.vehicle.vehicleId,
      }
    }

    return {
      id: `${stop.id}-${route.line}-schedule`,
      line: route.line,
      transportType: route.transportType,
      destination: route.destination,
      minutes: route.scheduleMinutes,
      isLive: false,
      isSimulated: false,
      distance: null,
      vehicleId: null,
      scheduleOrder: index,
    }
  }).sort((a, b) => a.minutes - b.minutes)
})

async function refreshVehicles() {
  try {
    const result = await getVehicles(stops)
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
  refreshVehicles()
  refreshTimer = window.setInterval(refreshVehicles, REFRESH_INTERVAL)
})
onUnmounted(() => window.clearInterval(refreshTimer))
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

    <section class="intro">
      <div class="eyebrow"><span class="eyebrow-line"></span>TALLINNA ÜHISTRANSPORT</div>
      <h1>Sinu järgmine<br /><span>sõit algab siit.</span></h1>
      <p class="intro-copy">Reaalajas saabumised. Et jõuaksid õigel ajal õigesse kohta.</p>
    </section>

    <div v-if="activeView === 'board'" class="content-grid">
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
            <p class="stop-direction">{{ selectedStop.direction }}</p>
          </div>
          <div class="update-status" :class="{ 'is-simulated': dataSource === 'simulated' }">
            <span>{{ dataSource === 'simulated' ? 'DEMOANDMED' : 'ANDMED' }}</span>
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
          </div>
          <p>Uueneb automaatselt iga 10 sekundi järel</p>
        </div>
      </section>
    </div>

    <TripPlanner
      v-else
      :stops="stops"
      :lines="transitLines"
      :vehicles="vehicles"
    />

    <footer class="page-footer">
      <span>Liigu linnas omas rütmis.</span>
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

.intro { padding: 67px 0 44px; }
.eyebrow { display: flex; align-items: center; gap: 10px; color: var(--green); font-size: 11px; font-weight: 700; letter-spacing: 1.2px; }
.eyebrow-line { display: inline-block; width: 18px; height: 1px; background: var(--green); }
.intro h1 { margin: 20px 0 12px; font-family: inherit; font-size: clamp(42px, 6vw, 64px); font-weight: 700; letter-spacing: -1.8px; line-height: 1.08; }
.intro h1 span { color: #78817a; }
.intro-copy { margin: 0; color: #a1a9a2; font-size: 16px; }

.content-grid { display: grid; grid-template-columns: 330px minmax(0, 1fr); align-items: start; gap: 48px; }
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
.legend-dot.bus { background: #a8e679; }
.legend-dot.tram { background: #ff8879; }
.legend-dot.trolley { background: #7facff; }
.page-footer { display: flex; justify-content: space-between; margin-top: auto; padding: 32px 0 24px; color: #929a94; font-size: 12px; }
.footer-divider { padding: 0 5px; color: #424a44; }

@media (max-width: 760px) {
  .app-shell { width: min(100% - 36px, 540px); }
  .topbar { height: 68px; }
  .view-tabs { margin-top: 14px; }
  .view-tabs button { padding: 8px 11px; font-size: 12px; }
  .intro { padding: 38px 0 28px; }
  .intro h1 { letter-spacing: -2.5px; }
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
