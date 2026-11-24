<script setup>
import { computed, ref, shallowRef, watch } from 'vue'
import LiveMap from './LiveMap.vue'
import StopSearch from './StopSearch.vue'
import { planRoutes } from '../services/routePlanner'
import { distanceBetween } from '../utils/etaCalculator'
import { groupStops } from '../utils/stopGroups'
import { journeyTimeline } from '../utils/journeyTimeline'

const props = defineProps({
  data: { type: Object, required: true },
  stops: { type: Array, required: true },
  vehicles: { type: Array, default: () => [] },
})

function dateValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function timeValue(date) {
  return new Intl.DateTimeFormat('et-EE', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

const now = new Date()
const fromQuery = ref('')
const toQuery = ref('')
const fromStop = shallowRef(null)
const toStop = shallowRef(null)
const selectedDate = ref(dateValue(now))
const selectedTime = ref(timeValue(now))
const searchMode = ref('depart')
const userLocation = ref(null)
const isLocating = ref(false)
const locationMessage = ref('')
const selectedTripId = ref(null)
const expandedLegs = ref(new Set())

watch(selectedTripId, () => { expandedLegs.value = new Set() })

function toggleLeg(legIndex) {
  if (expandedLegs.value.has(legIndex)) expandedLegs.value.delete(legIndex)
  else expandedLegs.value.add(legIndex)
}

const stopGroups = computed(() => groupStops(props.stops))

function stopLabel(stop) {
  return stopGroups.value.groupByStopId.get(stop.id)?.label || stop.name
}

const stopOptions = computed(() => stopGroups.value.groups.map((group) => {
  const label = group.label
  return {
    stop: group,
    label,
    searchName: group.name.toLocaleLowerCase('et'),
    searchLabel: label.toLocaleLowerCase('et'),
    searchText: `${label} ${group.stops.map((stop) => `${stop.alias || ''} ${stop.area || ''}`).join(' ')}`.toLocaleLowerCase('et'),
  }
}))

watch(() => props.stops, (stops) => {
  if (!stops.length) return
  const groups = stopGroups.value.groups
  const defaultFrom = groups.find((group) => group.name.toLocaleLowerCase('et').includes('vabaduse'))
  if (!fromStop.value) {
    fromStop.value = defaultFrom || groups[0]
    fromQuery.value = fromStop.value.label
  }
  if (!toStop.value) {
    toStop.value = groups.find((group) =>
      group.name.toLocaleLowerCase('et').includes('ülemiste jaam'),
    ) || groups.at(-1)
    toQuery.value = toStop.value.label
  }
}, { immediate: true })

const nearestUserStop = computed(() => {
  if (!userLocation.value) return null
  return props.stops.reduce((nearest, stop) => {
    const distance = distanceBetween(userLocation.value, stop.coordinates)
    return !nearest || distance < nearest.distance ? { stop, distance } : nearest
  }, null)
})
const walkMinutes = computed(() => nearestUserStop.value
  ? Math.max(1, Math.ceil(nearestUserStop.value.distance / 80))
  : 0)
const requestedTime = computed(() => {
  const value = new Date(`${selectedDate.value}T${selectedTime.value}`)
  return Number.isFinite(value.getTime()) ? value : new Date()
})
const isHistoricalView = computed(() => requestedTime.value.getTime() < Date.now() - 60_000)

const trips = computed(() => {
  if (!fromStop.value || !toStop.value || fromStop.value.id === toStop.value.id) return []

  const nowValue = new Date()
  const routeStartTime = new Date(requestedTime.value.getTime() +
    (searchMode.value === 'depart' ? walkMinutes.value * 60_000 : 0))
  return planRoutes({
    fromStops: nearestUserStop.value ? [nearestUserStop.value.stop] : fromStop.value.stops,
    toStops: toStop.value.stops,
    data: props.data,
    vehicles: props.vehicles,
    now: nowValue,
    departureAt: routeStartTime,
    searchMode: searchMode.value,
    includeWalkingOnly: !nearestUserStop.value,
    count: 5,
  }).map((trip) => ({
    ...trip,
    walkMinutes: walkMinutes.value,
    fromLabel: nearestUserStop.value
      ? `Minu asukoht · ${stopLabel(nearestUserStop.value.stop)}`
      : trip.from.name,
    isHistorical: isHistoricalView.value,
  }))
})

const selectedTrip = computed(() => trips.value.find((trip) => trip.id === selectedTripId.value) || null)
const invalidPlaces = computed(() => !fromStop.value || !toStop.value)
const scheduleNote = computed(() => {
  const endDate = props.data.source.endDate
  const validUntil = endDate
    ? `${endDate.slice(6, 8)}.${endDate.slice(4, 6)}.${endDate.slice(0, 4)}`
    : 'teadmata'
  return `Ametlik TLT sõiduplaan kehtib kuni ${validUntil}. Hilinemise hinnang arvutatakse GPS-asukoha ja graafiku võrdlusest.`
})

function clearSelection() {
  selectedTripId.value = null
}

function swapStops() {
  const origin = fromQuery.value
  fromQuery.value = toQuery.value
  toQuery.value = origin
  const originStop = fromStop.value
  fromStop.value = toStop.value
  toStop.value = originStop
  userLocation.value = null
  locationMessage.value = ''
  clearSelection()
}

function setFromStop() {
  fromStop.value = null
  userLocation.value = null
  locationMessage.value = ''
  clearSelection()
}

function selectFromStop(stop) {
  fromStop.value = stop
  userLocation.value = null
  locationMessage.value = ''
  clearSelection()
}

function setToStop() {
  toStop.value = null
  clearSelection()
}

function selectToStop(stop) {
  toStop.value = stop
  clearSelection()
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
      if (nearestUserStop.value) {
        fromStop.value = stopGroups.value.groupByStopId.get(nearestUserStop.value.stop.id)
        fromQuery.value = fromStop.value.label
      }
      locationMessage.value = nearestUserStop.value
        ? `Lähim peatus on ${stopLabel(nearestUserStop.value.stop)}.`
        : 'Asukoht on leitud.'
      isLocating.value = false
      clearSelection()
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

function setMode(mode) {
  searchMode.value = mode
  clearSelection()
}

function setNow() {
  const current = new Date()
  selectedDate.value = dateValue(current)
  selectedTime.value = timeValue(current)
  searchMode.value = 'depart'
  clearSelection()
}

function adjustTime(minutes) {
  const updated = new Date(requestedTime.value.getTime() + minutes * 60_000)
  selectedDate.value = dateValue(updated)
  selectedTime.value = timeValue(updated)
  clearSelection()
}

function formatClock(date) {
  return new Intl.DateTimeFormat('et-EE', { hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatDate(date) {
  return new Intl.DateTimeFormat('et-EE', {
    day: '2-digit',
    month: '2-digit',
  }).format(date)
}

function modeVerb() {
  return searchMode.value === 'arrive' ? 'Saabub' : 'Väljub'
}

function cardTimeText(trip) {
  return `${formatClock(trip.departsAt)} – ${formatClock(trip.arrivesAt)}`
}

function routeTrackColumns(trip) {
  const durations = trip.legs.flatMap((leg, index) =>
    index > 0 && leg.transferWalkMinutes ? [leg.transferWalkMinutes, leg.durationMinutes] : [leg.durationMinutes],
  )
  if (trip.destinationWalk) durations.push(trip.destinationWalk.minutes)
  return durations.map((minutes) => `minmax(0, ${Math.max(0.01, minutes)}fr)`).join(' ')
}

function cardDepartureText(trip) {
  const stopName = stopLabel(trip.from)
  if (trip.isWalkingOnly) return `Kõnni peatusest ${stopName} sihtkohta`
  const liveDeparture = trip.legs[0].estimatedDepartureAt
  if (trip.legs[0].isLive && liveDeparture) {
    return `Graafik ${formatClock(trip.departsAt)} · GPS-hinnang ${formatClock(liveDeparture)} · ${stopName}`
  }
  const verb = trip.departsAt.getTime() < Date.now() - 60_000 ? 'Väljus' : 'Väljub'
  return `${verb} ${formatClock(trip.departsAt)} peatusest ${stopName}`
}

function cardStatus(trip) {
  if (trip.isWalkingOnly) return 'Kõndimise hinnang'
  if (trip.legs[0].isLive && !trip.legs[0].isSimulated) return 'LIVE GPS · hinnang'
  if (trip.legs[0].isSimulated) return 'DEMO GPS · hinnang'
  return 'Ametlik sõiduplaan'
}

function delayText(trip) {
  const delay = trip.legs[0]?.estimatedDelayMinutes
  if (delay === null || delay === undefined) return ''
  if (Math.abs(delay) <= 1) return 'GPS-hinnang: graafikus'
  return `GPS-hinnang: ${Math.abs(delay)} min ${delay > 0 ? 'hilineb' : 'varem'}`
}
</script>

<template>
  <section class="planner">
    <div class="journey-search">
      <div class="place-inputs">
        <StopSearch
          v-model="fromQuery"
          :options="stopOptions"
          label="Otsi alguspunkti"
          list-id="from-stop-options"
          kind="origin"
          @edit="setFromStop"
          @select="selectFromStop"
        >
          <button
            class="current-location-button"
            type="button"
            :disabled="isLocating"
            @click="findMyLocation"
          >{{ isLocating ? 'Leian…' : 'Minu asukoht' }}</button>
        </StopSearch>

        <button class="swap-button" type="button" aria-label="Vaheta algus- ja sihtpunkt" @click="swapStops">⇅</button>

        <StopSearch
          v-model="toQuery"
          :options="stopOptions"
          label="Otsi sihtpunkti"
          list-id="to-stop-options"
          kind="destination"
          @edit="setToStop"
          @select="selectToStop"
        />
      </div>

      <div class="time-panel">
        <button class="close-time-panel" type="button" aria-label="Sea väljumisajaks praegune aeg" @click="setNow">×</button>
        <div class="time-panel-top">
          <div class="mode-switch" role="group" aria-label="Aja valiku tüüp">
            <button type="button" :class="{ active: searchMode === 'depart' }" @click="setMode('depart')">Väljub</button>
            <button type="button" :class="{ active: searchMode === 'arrive' }" @click="setMode('arrive')">Saabub</button>
          </div>
          <button class="leave-now-button" type="button" @click="setNow">Väljub kohe</button>
        </div>
        <div class="date-time-fields">
          <label class="date-field">
            <span aria-hidden="true">▦</span>
            <input v-model="selectedDate" type="date" aria-label="Vali kuupäev" @change="clearSelection" />
          </label>
          <label class="time-field">
            <span aria-hidden="true">◷</span>
            <input v-model="selectedTime" type="time" aria-label="Vali kellaaeg" @change="clearSelection" />
          </label>
        </div>
      </div>
    </div>

    <p v-if="locationMessage" class="location-message" role="status">{{ locationMessage }}</p>
    <p v-else class="schedule-note">{{ scheduleNote }}</p>

    <div v-if="invalidPlaces" class="planner-message">
      Vali loendist kehtiv algus- ja sihtpunkt.
    </div>
    <div v-else-if="fromStop.id === toStop.id" class="planner-message">
      Algus- ja sihtpunkt peavad olema erinevad.
    </div>
    <div v-else-if="!trips.length" class="planner-message">
      Selleks ajaks sobivat teekonda ei leitud.
    </div>

    <template v-else>
      <div class="results-toolbar">
        <span>{{ modeVerb() }} {{ formatDate(requestedTime) }} kell {{ formatClock(requestedTime) }}</span>
        <span>{{ trips.length }} teekonda</span>
      </div>
      <button class="paging-button previous-button" type="button" @click="adjustTime(-30)">
        <span aria-hidden="true">⌃</span> Varasem
      </button>

      <div class="trip-list">
        <article
          v-for="trip in trips"
          :key="`${trip.id}-${trip.departsAt.getTime()}`"
          class="trip-entry"
          :class="{ 'trip-entry-selected': selectedTripId === `${trip.id}-${trip.departsAt.getTime()}` }"
        >
          <button
            class="trip-card"
            type="button"
            :aria-expanded="selectedTripId === `${trip.id}-${trip.departsAt.getTime()}`"
            @click="selectedTripId = selectedTripId === `${trip.id}-${trip.departsAt.getTime()}` ? null : `${trip.id}-${trip.departsAt.getTime()}`"
          >
            <span class="trip-card-top">
              <strong>{{ cardTimeText(trip) }}</strong>
              <strong>{{ trip.durationMinutes }} min</strong>
            </span>
            <span class="route-track" :style="{ gridTemplateColumns: routeTrackColumns(trip) }">
              <template v-for="(leg, legIndex) in trip.legs" :key="`${leg.line}-${legIndex}`">
                <span
                  v-if="legIndex > 0 && leg.transferWalkMinutes"
                  class="walk-chip"
                  :title="`${leg.transferWalkMinutes} min kõndi ümberistumiseks`"
                >♙<small>{{ leg.transferWalkMinutes }}</small></span>
                <span class="route-line-chip" :class="leg.transportType" :title="`Liin ${leg.line} · ${leg.durationMinutes} min`">
                  <svg class="transport-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <template v-if="leg.transportType === 'tram'">
                      <path d="M8 3h8M12 3v2m-5 16 2-3m8 3-2-3M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v11H5V7Z" />
                      <path d="M5 13h14M8 8h2m4 0h2" />
                    </template>
                    <template v-else-if="leg.transportType === 'trolley'">
                      <path d="m9 5 2-3m4 3 2-3M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12H5V7Z" />
                      <path d="M5 13h14M8 9h2m4 0h2M8 22l1-3m6 3-1-3" />
                    </template>
                    <template v-else>
                      <path d="M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14H5V5Z" />
                      <path d="M5 13h14M8 7h2m4 0h2M8 22l1-3m6 3-1-3" />
                    </template>
                  </svg>
                  {{ leg.line }}
                </span>
              </template>
              <span v-if="trip.destinationWalk" class="walk-chip" :title="`Kõndimise hinnang ${trip.destinationWalk.minutes} min`">
                ♙<small>{{ trip.destinationWalk.minutes }}</small>
              </span>
            </span>
            <span class="trip-card-bottom">
              <span>{{ cardDepartureText(trip) }}</span>
              <span class="trip-chevron" aria-hidden="true">›</span>
            </span>
            <span class="trip-card-status">
              <span :class="trip.legs[0]?.isLive && !trip.legs[0]?.isSimulated ? 'live-status' : 'scheduled-status'"></span>
              {{ cardStatus(trip) }}
              <span v-if="delayText(trip)" class="delay-indicator">{{ delayText(trip) }}</span>
              <span v-if="!trip.isWalkingOnly" class="trip-stops">{{ trip.stopCount }} peatust</span>
            </span>
          </button>

          <div v-if="selectedTripId === `${trip.id}-${trip.departsAt.getTime()}`" class="trip-detail">
            <div class="detail-summary">
              <span>◷ {{ trip.durationMinutes }} min</span>
              <span v-if="trip.walkMinutes">♙ {{ trip.walkMinutes }} min kõndi</span>
              <span v-if="trip.destinationWalk">♙ {{ trip.destinationWalk.minutes }} min kõndi (hinnang)</span>
              <span v-if="trip.transferMinutes">↔ {{ trip.transferMinutes }} min ümberistumiseks</span>
              <span>{{ formatDate(trip.departsAt) }} · {{ formatClock(trip.departsAt) }}–{{ formatClock(trip.arrivesAt) }}</span>
            </div>
            <ol class="journey-steps">
              <li
                v-for="(step, index) in journeyTimeline(trip, nearestUserStop, expandedLegs)"
                :key="`${trip.id}-${trip.departsAt.getTime()}-${index}`"
                class="journey-step"
                :class="[step.connection ? `connection-${step.connection}` : '', { 'journey-step-toggle': step.type === 'toggle' }]"
              >
                <time v-if="step.timeAt">{{ formatClock(step.timeAt) }}</time>
                <span v-else></span>
                <span v-if="step.type === 'walk'" class="timeline-action" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <circle cx="13" cy="3.5" r="2" />
                    <path d="m9 10 3-3 3 2 2 3 3 1M12 7l-2 7-3 7m3-7 4 2 2 5M9 10l-2 4H4" />
                  </svg>
                </span>
                <span v-else-if="step.type === 'wait'" class="timeline-action wait-action" aria-hidden="true">◷</span>
                <span v-else-if="step.type === 'toggle'"></span>
                <span v-else class="timeline-marker" :class="`marker-${step.marker}`"></span>
                <span v-if="step.type === 'location'" class="step-copy">
                  <strong>Minu asukoht</strong>
                </span>
                <span v-else-if="step.type === 'walk'" class="step-copy">
                  <small>
                    Kõnni<span v-if="step.distanceMeters"> umbes {{ step.distanceMeters }} m</span>
                    · {{ step.minutes }} min<span v-if="step.estimated"> (hinnang)</span>
                  </small>
                </span>
                <span v-else-if="step.type === 'wait'" class="step-copy">
                  <small>Oota {{ step.minutes }} min</small>
                </span>
                <button
                  v-else-if="step.type === 'toggle'"
                  class="stops-toggle"
                  type="button"
                  :aria-expanded="expandedLegs.has(step.legIndex)"
                  :aria-label="`${expandedLegs.has(step.legIndex) ? 'Peida' : 'Näita'} liini ${step.line} ${step.stopCount} ${step.stopCount === 1 ? 'vahepeatus' : 'vahepeatust'}`"
                  @click="toggleLeg(step.legIndex)"
                >
                  <span>{{ expandedLegs.has(step.legIndex) ? 'Peida vahepeatused' : `${step.stopCount} ${step.stopCount === 1 ? 'vahepeatus' : 'vahepeatust'}` }} <span class="stops-duration">({{ step.durationMinutes }} min)</span></span>
                  <span class="stops-chevron" aria-hidden="true">{{ expandedLegs.has(step.legIndex) ? '⌃' : '⌄' }}</span>
                </button>
                <span v-else class="step-copy">
                  <strong>{{ stopLabel(step.stop) }}</strong>
                  <small v-if="step.detail === 'boarding'">
                    Väljumine · liin {{ step.line }}
                    <template v-if="step.firstBoarding && trip.legs[0]?.isLive">
                      · {{ delayText(trip) || 'GPS nähtav' }}
                    </template>
                  </small>
                  <small v-else-if="step.detail === 'intermediate'">{{ step.line }} · vahepeatus</small>
                  <small v-else-if="step.detail === 'transfer'">Maha · ümberistumine</small>
                  <small v-else-if="step.detail === 'transfer-arrival'">Ümberistumispeatus</small>
                  <small v-else-if="step.detail === 'walk-start'">Kõndimise algus</small>
                  <small v-else-if="step.detail === 'destination' || !trip.destinationWalk">Saabumine sihtkohta</small>
                  <small v-else>Maha</small>
                </span>
                <span v-if="step.type === 'stop' || step.type === 'location'" class="step-map-icon" aria-hidden="true">⌖</span>
              </li>
            </ol>
            <p v-if="trip.destinationWalk" class="walking-note">
              Kõnniaeg ja -vahemaa on hinnangulised; tegelikku jalakäijate teekonda ei ole arvutatud.
            </p>
            <div class="map-caption">
              <strong>Teekond kaardil</strong>
              <span>{{ trip.isWalkingOnly ? 'Kõndimise suund on hinnanguline' : trip.legs[0].isLive && !trip.legs[0].isSimulated ? 'Reaalaja GPS · hilinemise hinnang' : 'TLT sõiduplaani teekonnakuju' }}</span>
            </div>
            <LiveMap :stops="stops" :vehicles="vehicles" :trip="trip" :user-location="userLocation" />
          </div>
        </article>
      </div>

      <button class="paging-button later-button" type="button" @click="adjustTime(30)">
        <span aria-hidden="true">⌄</span> Hiljem
      </button>
    </template>
  </section>
</template>

<style scoped>
.planner { min-width: 0; margin-top: 38px; }
.journey-search { overflow: visible; padding: 14px; border: 1px solid #2a302c; border-radius: 12px; background: #171b18; }
.place-inputs { position: relative; display: grid; gap: 8px; }
.current-location-button { padding: 6px 8px; border: 0; color: #b8d99a; background: transparent; cursor: pointer; font-size: 12px; white-space: nowrap; }
.current-location-button:disabled { opacity: .7; cursor: wait; }
.swap-button { position: absolute; z-index: 5; top: 42px; left: 18px; width: 28px; height: 28px; border: 1px solid #444d46; border-radius: 50%; color: #e2e8e2; background: #252b26; cursor: pointer; font-size: 16px; }
.time-panel { position: relative; display: grid; gap: 12px; margin-top: 10px; padding: 14px; border-radius: 8px; background: #202420; }
.close-time-panel { position: absolute; top: 3px; right: 7px; padding: 0; border: 0; color: #c7d0c8; background: transparent; cursor: pointer; font-size: 23px; line-height: 1; }
.time-panel-top { display: flex; align-items: center; gap: 10px; padding-right: 20px; }
.mode-switch { display: flex; padding: 2px; border-radius: 8px; background: #353a36; }
.mode-switch button { min-width: 84px; padding: 8px 12px; border: 0; border-radius: 6px; color: #e3e7e3; background: transparent; cursor: pointer; font-size: 14px; }
.mode-switch button.active { color: #202420; background: #f0f2f0; }
.leave-now-button { padding: 8px 13px; border: 1px solid #aeb8b0; border-radius: 20px; color: #f0f3f0; background: transparent; cursor: pointer; font-size: 13px; }
.date-time-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, .58fr); gap: 8px; }
.date-field, .time-field { display: flex; min-width: 0; height: 42px; align-items: center; gap: 9px; padding: 0 10px; border: 1px solid #717a73; border-radius: 6px; background: #111512; }
.date-field > span, .time-field > span { color: #77bded; font-size: 17px; }
.date-field input, .time-field input { width: 100%; min-width: 0; border: 0; outline: 0; color: #f1f3f1; background: transparent; font-size: 14px; }
.date-field input::-webkit-calendar-picker-indicator, .time-field input::-webkit-calendar-picker-indicator { filter: invert(.9); }
.schedule-note, .location-message { margin: 10px 2px 0; color: #a4ada5; font-size: 12px; line-height: 1.5; }
.walking-note { margin: 8px 4px; color: #c2cbc3; font-size: 12px; line-height: 1.5; }
.location-message { color: #c3dfa8; }
.results-toolbar { display: flex; justify-content: space-between; margin: 24px 3px 8px; color: #aab3ab; font-size: 13px; }
.paging-button { display: flex; width: 100%; align-items: center; gap: 10px; padding: 12px 17px; border: 0; border-bottom: 1px solid #353c36; color: #c6d0c7; background: transparent; cursor: pointer; font-size: 14px; text-align: left; }
.paging-button:hover { color: #fff; background: #191e1a; }
.paging-button span { font-size: 20px; line-height: 1; }
.trip-list { display: grid; }
.trip-entry { border-bottom: 1px solid #353c36; }
.trip-card { display: grid; width: 100%; gap: 8px; padding: 15px 3px; border: 0; color: inherit; background: transparent; cursor: pointer; text-align: left; }
.trip-card:hover, .trip-entry-selected .trip-card { background: #171b18; }
.trip-card-top, .trip-card-bottom { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.trip-card-top strong { color: #f1f4f1; font-size: 16px; }
.trip-card-top strong:last-child { white-space: nowrap; }
.route-track { display: grid; min-width: 0; height: 29px; align-items: stretch; gap: 4px; }
.route-line-chip { display: flex; min-width: 0; overflow: hidden; align-items: center; gap: 6px; padding: 0 8px; border-radius: 4px; color: #08251e; background: #00c99a; font-size: 14px; font-weight: 700; white-space: nowrap; }
.route-line-chip.tram { color: #2a1008; background: #ff642e; }
.route-line-chip.trolley { color: #fff; background: #174d9b; }
.transport-icon { width: 18px; height: 18px; flex: 0 0 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.walk-chip { display: flex; min-width: 0; overflow: hidden; align-items: center; justify-content: center; gap: 3px; border-radius: 4px; color: #303630; background: #d7dad7; font-size: 16px; white-space: nowrap; }
.walk-chip small { font-size: 11px; }
.trip-card-bottom { color: #d4d9d4; font-size: 13px; }
.trip-chevron { color: #39aee5; font-size: 28px; line-height: 20px; }
.trip-card-status { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; color: #aab3ab; font-size: 11px; }
.live-status, .scheduled-status { width: 7px; height: 7px; border-radius: 50%; background: #a4e271; }
.scheduled-status { background: #e0b95f; }
.delay-indicator { color: #f0c879; }
.trip-stops { margin-left: auto; }
.trip-detail { padding: 13px 10px 17px; border-top: 1px solid #303832; background: #141815; }
.detail-summary { display: flex; flex-wrap: wrap; gap: 14px; margin: 0 0 13px 4px; color: #c0c9c1; font-size: 12px; }
.journey-steps { display: grid; margin: 0; padding: 0; list-style: none; }
.journey-step { position: relative; display: grid; min-height: 60px; grid-template-columns: 48px 20px minmax(0, 1fr) 24px; align-items: start; gap: 8px; padding: 9px 0; }
.journey-step:not(:last-child)::after { position: absolute; top: 25px; bottom: -9px; left: 64px; border-left: 4px solid #838c84; content: ''; }
.journey-step-toggle:not(:last-child)::after { top: 9px; }
.journey-step.connection-bus::after { border-color: #00c99a; }
.journey-step.connection-tram::after { border-color: #ff642e; }
.journey-step.connection-trolley::after { border-color: #174d9b; }
.journey-step.connection-walk::after { border-left-style: dotted; border-color: #a8b1a9; }
.journey-step.connection-wait::after { border-color: #838c84; }
.timeline-marker { z-index: 1; width: 18px; height: 18px; border: 4px solid #a8b1a9; border-radius: 50%; background: #141815; }
.marker-bus { border-color: #00c99a; }
.marker-tram { border-color: #ff642e; }
.marker-trolley { border-color: #174d9b; }
.marker-origin, .marker-destination { border-width: 5px; background: #fff; }
.marker-origin { border-color: #69ae19; }
.marker-destination { border-color: #fa729a; }
.timeline-action { z-index: 1; display: grid; width: 20px; height: 24px; place-items: center; color: #c6cec7; background: #141815; }
.timeline-action svg { width: 20px; height: 20px; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.wait-action { font-size: 23px; line-height: 1; }
.journey-step time { padding-top: 1px; color: #d4dad4; font-size: 13px; font-variant-numeric: tabular-nums; }
.step-copy { display: grid; gap: 5px; min-width: 0; }
.step-copy strong { color: #eff2ef; font-size: 14px; font-weight: 500; }
.step-copy small { color: #a8b1a9; font-size: 12px; line-height: 1.4; }
.stops-toggle { grid-column: 3 / -1; display: flex; min-width: 0; min-height: 42px; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 3px 5px 0; border: 0; color: #75bde9; background: transparent; cursor: pointer; font-size: 14px; text-align: left; }
.stops-toggle:hover { color: #b6e4ff; }
.stops-toggle:focus-visible { outline: 2px solid #75bde9; outline-offset: 2px; }
.stops-duration { color: #a8b1a9; white-space: nowrap; }
.stops-chevron { font-size: 23px; line-height: 1; }
.step-map-icon { color: #39aee5; font-size: 20px; text-align: center; }
.map-caption { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 12px 0 8px; }
.map-caption strong { font-size: 14px; }
.map-caption span { color: #a8b1a9; font-size: 11px; }
.planner-message { margin-top: 18px; padding: 16px; border: 1px solid #353c36; border-radius: 8px; color: #c2cbc3; background: #171b18; font-size: 14px; line-height: 1.5; }
.later-button { justify-content: center; color: #75bde9; }

@media (max-width: 600px) {
  .planner { margin-top: 24px; }
  .journey-search { padding: 10px; }
  .current-location-button { padding: 5px; font-size: 11px; }
  .time-panel { padding: 12px; }
  .mode-switch button { min-width: 72px; padding: 8px 9px; font-size: 13px; }
  .leave-now-button { padding: 8px 10px; font-size: 12px; }
  .date-time-fields { grid-template-columns: minmax(0, 1fr) minmax(108px, .65fr); }
  .date-field, .time-field { gap: 5px; padding: 0 6px; }
  .date-field input, .time-field input { font-size: 12px; }
  .trip-card-top strong { font-size: 15px; }
  .trip-card-bottom { font-size: 12px; }
  .journey-step { grid-template-columns: 42px 20px minmax(0, 1fr) 20px; gap: 6px; }
  .journey-step:not(:last-child)::after { left: 56px; }
  .map-caption { align-items: flex-start; flex-direction: column; gap: 4px; }
}
</style>
