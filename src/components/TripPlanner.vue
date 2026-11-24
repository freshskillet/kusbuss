<script setup>
import { computed, ref } from 'vue'
import LiveMap from './LiveMap.vue'
import { planRoutes } from '../services/routePlanner'
import { distanceBetween } from '../utils/etaCalculator'

const props = defineProps({
  stops: { type: Array, required: true },
  lines: { type: Array, required: true },
  vehicles: { type: Array, default: () => [] },
})

const fromStopId = ref('vabaduse-valjak')
const toStopId = ref('ulemiste-jaam')
const userLocation = ref(null)
const isLocating = ref(false)
const locationMessage = ref('')
const selectedTripId = ref(null)

const fromStop = computed(() => props.stops.find((stop) => stop.id === fromStopId.value))
const toStop = computed(() => props.stops.find((stop) => stop.id === toStopId.value))
const nearestUserStop = computed(() => {
  if (!userLocation.value) return null
  return props.stops.reduce((nearest, stop) => {
    const distance = distanceBetween(userLocation.value, stop.coordinates)
    return !nearest || distance < nearest.distance ? { stop, distance } : nearest
  }, null)
})
const effectiveFromStop = computed(() => nearestUserStop.value?.stop || fromStop.value)
const trips = computed(() => {
  const foundTrips = planRoutes({
    fromStop: effectiveFromStop.value,
    toStop: toStop.value,
    stops: props.stops,
    lines: props.lines,
    vehicles: props.vehicles,
  })

  return foundTrips.map((trip) => {
    const walkMinutes = nearestUserStop.value ? Math.ceil(nearestUserStop.value.distance / 80) : 0
    const totalMinutes = trip.totalMinutes + walkMinutes
    return {
      ...trip,
      walkMinutes,
      totalMinutes,
      fromLabel: nearestUserStop.value
        ? `Minu asukoht · ${nearestUserStop.value.stop.name}`
        : trip.from.name,
      arrivesAt: new Date(Date.now() + totalMinutes * 60_000),
    }
  })
})
const selectedTrip = computed(() => trips.value.find((trip) => trip.id === selectedTripId.value) || null)

function swapStops() {
  const currentFrom = fromStopId.value
  fromStopId.value = toStopId.value
  toStopId.value = currentFrom
  userLocation.value = null
  locationMessage.value = ''
  selectedTripId.value = null
}

function setFromStop() {
  userLocation.value = null
  locationMessage.value = ''
  selectedTripId.value = null
}

function setToStop() {
  selectedTripId.value = null
}

function findMyLocation() {
  locationMessage.value = ''
  if (!navigator.geolocation) {
    locationMessage.value = 'Sinu brauser ei toeta asukoha määramist.'
    return
  }
  isLocating.value = true
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      userLocation.value = { lat: coords.latitude, lon: coords.longitude }
      selectedTripId.value = null
      locationMessage.value = nearestUserStop.value
        ? `Lähim peatus on ${nearestUserStop.value.stop.name}.`
        : 'Asukoht on leitud.'
      isLocating.value = false
    },
    (error) => {
      const messages = {
        1: 'Asukoha kasutamiseks luba brauseris ligipääs.',
        2: 'Asukohta ei õnnestunud tuvastada.',
        3: 'Asukoha päring aegus. Proovi uuesti.',
      }
      locationMessage.value = messages[error.code] || 'Asukoha leidmine ebaõnnestus.'
      isLocating.value = false
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  )
}

function formatClock(date) {
  return new Intl.DateTimeFormat('et-EE', { hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatDeparture(leg) {
  if (!leg.isLive) return `Graafik · umbes ${leg.waitMinutes} min`
  if (leg.waitMinutes === 0) return 'Kohe'
  return `${leg.waitMinutes} min pärast`
}
</script>

<template>
  <section class="planner">
    <div class="planner-heading">
      <div>
        <p class="planner-kicker">REISIPLANEERIJA</p>
        <h2>Kuhu sõidame?</h2>
        <p class="planner-subtitle">Leia sobiv teekond Tallinna ühistranspordiga.</p>
      </div>
      <span class="planner-icon" aria-hidden="true">↗</span>
    </div>

    <div class="planner-form">
      <label class="place-field">
        <span class="place-symbol origin-symbol"></span>
        <span class="place-input">
          <small>LÄHTEKOHT</small>
          <select v-model="fromStopId" aria-label="Lähtekoht" @change="setFromStop">
            <option v-for="stop in stops" :key="stop.id" :value="stop.id">{{ stop.name }}</option>
          </select>
        </span>
        <button class="location-button" type="button" :disabled="isLocating" @click="findMyLocation">
          {{ isLocating ? 'Leian…' : 'Minu asukoht' }}
        </button>
      </label>

      <button class="swap-button" type="button" aria-label="Vaheta lähte- ja sihtkoht" @click="swapStops">⇅</button>

      <label class="place-field destination-field">
        <span class="place-symbol destination-symbol"></span>
        <span class="place-input">
          <small>SIHTKOHT</small>
          <select v-model="toStopId" aria-label="Sihtkoht" @change="setToStop">
            <option v-for="stop in stops" :key="stop.id" :value="stop.id">{{ stop.name }}</option>
          </select>
        </span>
      </label>
    </div>
    <p v-if="locationMessage" class="location-message" role="status">{{ locationMessage }}</p>

    <div class="results-heading">
      <h3>Teekonnavariandid</h3>
      <span v-if="trips.length">{{ trips.length }} varianti</span>
    </div>
    <div v-if="fromStopId === toStopId && !userLocation" class="planner-message">
      Vali lähte- ja sihtkohaks erinevad peatused.
    </div>
    <div v-else-if="!trips.length" class="planner-message">
      Nende peatuste vahel sobivat otseliini ega ühe ümberistumisega teekonda ei leitud.
    </div>
    <div v-else class="trip-list">
      <button
        v-for="trip in trips"
        :key="trip.id"
        class="trip-card"
        :class="{ 'trip-card-selected': selectedTripId === trip.id }"
        type="button"
        :aria-pressed="selectedTripId === trip.id"
        @click="selectedTripId = selectedTripId === trip.id ? null : trip.id"
      >
        <span class="trip-time">{{ formatClock(trip.arrivesAt) }}</span>
        <span class="trip-main">
          <span class="trip-route">
            <span v-for="(leg, index) in trip.legs" :key="`${trip.id}-${index}`" class="trip-leg">
              <span class="trip-line" :class="leg.transportType">{{ leg.line }}</span>
              <span class="trip-direction">{{ leg.destination }}</span>
              <span v-if="index < trip.legs.length - 1" class="transfer-mark">→</span>
            </span>
          </span>
          <span class="trip-summary">
            <span v-if="trip.legs[0].isLive && !trip.legs[0].isSimulated" class="live-label">LIVE</span>
            <span v-else-if="trip.legs[0].isSimulated" class="demo-label">DEMO</span>
            <span v-else class="schedule-label">GRAAFIK</span>
            <span>{{ trip.legs[0].isLive ? formatDeparture(trip.legs[0]) : `väljub umbes ${trip.legs[0].waitMinutes} min pärast` }}</span>
            <span class="summary-separator">·</span>
            <span>{{ trip.stopCount }} peatust</span>
            <span class="summary-separator">·</span>
            <span>{{ trip.totalMinutes }} min</span>
          </span>
          <span class="trip-endpoint">Saabub sihtkohta {{ formatClock(trip.arrivesAt) }}</span>
        </span>
        <span class="trip-open" aria-hidden="true">{{ selectedTripId === trip.id ? '−' : '+' }}</span>
      </button>
    </div>

    <section v-if="selectedTrip" class="trip-detail">
      <div class="detail-heading">
        <div>
          <p class="planner-kicker">VALITUD TEEKOND</p>
          <h3>{{ selectedTrip.fromLabel }} <span>→</span> {{ selectedTrip.to.name }}</h3>
        </div>
        <span class="detail-arrival">{{ formatClock(selectedTrip.arrivesAt) }}</span>
      </div>
      <ol class="journey-steps">
        <li v-for="(step, index) in selectedTrip.journeySteps" :key="`${step.stop.id}-${index}`">
          <span class="step-marker" :class="{ 'step-origin': index === 0, 'step-destination': index === selectedTrip.journeySteps.length - 1 }"></span>
          <span>{{ step.stop.name }}</span>
          <small v-if="index === 0">Peale</small>
          <small v-else-if="index === selectedTrip.journeySteps.length - 1">Maha</small>
          <small v-else-if="step.transferTo">Ümberistumine · {{ step.line }} → {{ step.transferTo }}</small>
          <small v-else>{{ step.line }} · vahepeatus</small>
        </li>
      </ol>
      <div class="map-caption">
        <strong>Reaalaja kaart</strong>
        <span v-if="selectedTrip.legs[0].isLive && !selectedTrip.legs[0].isSimulated">Näidatakse lähenevat liini {{ selectedTrip.legs[0].line }} sõidukit</span>
        <span v-else-if="selectedTrip.legs[0].isSimulated">Liini {{ selectedTrip.legs[0].line }} sõiduk on näidisandmetel</span>
        <span v-else>Sõiduki GPS-positsiooni pole saadaval; kuvatakse liin ja peatused</span>
      </div>
      <LiveMap
        :stops="stops"
        :vehicles="vehicles"
        :trip="selectedTrip"
        :user-location="userLocation"
      />
      <p class="map-attribution-note">Kaardiandmed © OpenStreetMapi kaasautorid.</p>
    </section>
  </section>
</template>

<style scoped>
.planner { min-width: 0; }
.planner-heading { display: flex; align-items: flex-start; justify-content: space-between; margin: 3px 0 24px; }
.planner-kicker { margin: 0 0 8px; color: #a9c88b; font-size: 11px; font-weight: 700; letter-spacing: .8px; }
.planner-heading h2 { margin: 0; font-size: 32px; font-weight: 700; letter-spacing: -.5px; }
.planner-subtitle { margin: 7px 0 0; color: #a2aaa3; font-size: 15px; }
.planner-icon { display: grid; width: 42px; height: 42px; place-items: center; border: 1px solid #384238; border-radius: 10px; color: #b7f36b; background: #1c2419; font-size: 23px; }
.planner-form { position: relative; display: grid; gap: 9px; padding: 15px; border: 1px solid #2a302c; border-radius: 14px; background: #171b18; }
.place-field { display: flex; min-width: 0; min-height: 64px; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid #303832; border-radius: 9px; background: #111512; }
.place-symbol { width: 11px; height: 11px; flex: 0 0 11px; border: 2px solid #b7f36b; border-radius: 50%; }
.destination-symbol { border-color: #ff8879; border-radius: 3px; }
.place-input { display: grid; min-width: 0; flex: 1; gap: 3px; }
.place-input small { color: #a2aaa3; font-size: 10px; font-weight: 700; letter-spacing: .6px; }
.place-input select { width: 100%; padding: 0; border: 0; outline: 0; color: #f2f4f2; background: transparent; font-size: 16px; }
.place-input option { color: #f2f4f2; background: #171b18; }
.location-button { padding: 8px 10px; border: 1px solid #3b4b34; border-radius: 7px; color: #c9efa8; background: #20271e; cursor: pointer; font-size: 12px; white-space: nowrap; }
.location-button:disabled { opacity: .7; cursor: wait; }
.swap-button { position: absolute; z-index: 1; top: 76px; right: 27px; width: 32px; height: 32px; border: 1px solid #3b433d; border-radius: 8px; color: #d7ddd8; background: #242a25; cursor: pointer; font-size: 18px; }
.location-message { margin: 8px 2px 0; color: #b6d59a; font-size: 13px; }
.results-heading { display: flex; align-items: center; justify-content: space-between; margin: 27px 2px 12px; }
.results-heading h3 { margin: 0; font-size: 20px; }
.results-heading > span { color: #a2aaa3; font-size: 13px; }
.trip-list { display: grid; gap: 9px; }
.trip-card { display: grid; width: 100%; grid-template-columns: 58px minmax(0, 1fr) 22px; align-items: start; gap: 13px; padding: 16px; border: 1px solid #303832; border-radius: 12px; color: inherit; background: #171b18; cursor: pointer; text-align: left; }
.trip-card:hover, .trip-card-selected { border-color: #718359; background: #1b211a; }
.trip-time { padding-top: 3px; color: #e7f2dc; font-size: 17px; font-weight: 700; }
.trip-main { display: grid; min-width: 0; gap: 8px; }
.trip-route, .trip-leg { display: flex; align-items: center; gap: 9px; }
.trip-route { flex-wrap: wrap; row-gap: 7px; }
.trip-line { display: grid; min-width: 32px; height: 29px; place-items: center; padding: 0 6px; border-radius: 6px; color: #b9ef8b; background: #293825; font-size: 14px; font-weight: 700; }
.trip-line.tram { color: #ff9a8d; background: #3a2825; }
.trip-line.trolley { color: #8db4ff; background: #242e42; }
.trip-direction { color: #e0e6e0; font-size: 14px; }
.transfer-mark { color: #929a94; }
.trip-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: #b1b9b2; font-size: 12px; line-height: 1.5; }
.live-label, .schedule-label { color: #c4e6a3; font-size: 10px; font-weight: 700; letter-spacing: .3px; }
.schedule-label { color: #e5c586; }
.demo-label { color: #e5c586; font-size: 10px; font-weight: 700; letter-spacing: .3px; }
.summary-separator { color: #6f786f; }
.trip-endpoint { color: #c6d9ba; font-size: 13px; }
.trip-open { color: #b8c2b9; font-size: 20px; line-height: 1; }
.planner-message { padding: 18px; border: 1px solid #303832; border-radius: 10px; color: #b1b9b2; background: #171b18; font-size: 14px; line-height: 1.5; }
.trip-detail { margin-top: 18px; padding: 17px; border: 1px solid #303832; border-radius: 13px; background: #171b18; }
.detail-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 15px; }
.detail-heading h3 { margin: 0; font-size: 18px; }
.detail-heading h3 span { color: #a2aaa3; }
.detail-arrival { color: #d7efc5; font-size: 17px; font-weight: 700; white-space: nowrap; }
.journey-steps { display: grid; gap: 0; margin: 0 0 19px 5px; padding: 0; list-style: none; }
.journey-steps li { position: relative; display: grid; min-height: 42px; grid-template-columns: 15px minmax(0, 1fr) auto; align-items: center; gap: 9px; color: #e3e8e3; font-size: 14px; }
.journey-steps li:not(:last-child)::after { position: absolute; top: 25px; bottom: -16px; left: 6px; width: 1px; background: #56604f; content: ''; }
.step-marker { z-index: 1; width: 11px; height: 11px; border: 2px solid #aeb8ac; border-radius: 50%; background: #171b18; }
.step-marker.step-origin { border-color: #b7f36b; background: #b7f36b; }
.step-marker.step-destination { border-color: #ff8879; border-radius: 3px; background: #ff8879; }
.journey-steps small { color: #9ba49c; font-size: 11px; text-align: right; }
.map-caption { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 9px; }
.map-caption strong { font-size: 15px; }
.map-caption span, .map-attribution-note { color: #9ba49c; font-size: 11px; }
.map-attribution-note { margin: 8px 0 0; }

@media (max-width: 600px) {
  .planner-heading { margin-bottom: 18px; }
  .planner-heading h2 { font-size: 28px; }
  .planner-subtitle { font-size: 14px; }
  .planner-form { padding: 11px; }
  .place-field { min-height: 60px; gap: 9px; padding: 9px; }
  .place-input select { font-size: 14px; }
  .location-button { padding: 7px; font-size: 11px; }
  .swap-button { right: 22px; }
  .trip-card { grid-template-columns: 48px minmax(0, 1fr) 16px; gap: 9px; padding: 13px 10px; }
  .trip-time { font-size: 15px; }
  .trip-summary { font-size: 11px; }
  .detail-heading h3 { font-size: 16px; }
  .detail-arrival { font-size: 15px; }
  .trip-detail { padding: 12px; }
  .map-caption { align-items: flex-start; flex-direction: column; gap: 4px; }
}
</style>
