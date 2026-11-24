<script setup>
import { computed, ref, shallowRef, watch } from 'vue'
import LiveMap from './LiveMap.vue'
import StopSearch from './StopSearch.vue'
import { matchItineraryVehicles } from '../services/routePlanner'
import { fetchItineraries } from '../services/digitransit'
import { adaptItineraries } from '../services/digitransitAdapter'
import { distanceBetween } from '../utils/etaCalculator'
import { groupStops } from '../utils/stopGroups'
import { journeyTimeline } from '../utils/journeyTimeline'
import { countyRealtimeUrl } from '../utils/countyRealtime'

const props = defineProps({
  data: { type: Object, required: true },
  stops: { type: Array, required: true },
  vehicles: { type: Array, default: () => [] },
  active: { type: Boolean, default: true },
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
const trackedVehicles = shallowRef(new Map())
const searchExpanded = ref(false)
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
const requestedTime = computed(() => {
  const value = new Date(`${selectedDate.value}T${selectedTime.value}`)
  return Number.isFinite(value.getTime()) ? value : new Date()
})
const isHistoricalView = computed(() => requestedTime.value.getTime() < Date.now() - 60_000)

const itineraryResults = shallowRef([])
const routingError = ref('')
const routingLoading = ref(false)
const routingAttempt = ref(0)
watch(
  [fromStop, toStop, userLocation, requestedTime, searchMode, searchExpanded, () => props.active, routingAttempt],
  async ([origin, destination, location, at, mode, expanded, active], _, onCleanup) => {
    itineraryResults.value = []
    routingError.value = ''
    routingLoading.value = false
    if (!expanded || !active || !origin || !destination || (origin.id === destination.id && !location)) return

    const controller = new AbortController()
    onCleanup(() => controller.abort())
    const from = { ...(location || origin.stops[0].coordinates), name: location ? 'Minu asukoht' : origin.label }
    const to = { ...destination.stops[0].coordinates, name: destination.label }
    routingLoading.value = true
    try {
      const results = await fetchItineraries({ from, to, at, searchMode: mode, signal: controller.signal })
      if (!controller.signal.aborted) {
        itineraryResults.value = adaptItineraries(results, { from, to, routes: props.data.routes || [] })
          .sort((a, b) => mode === 'arrive'
            ? b.arrivesAt - a.arrivesAt || b.departsAt - a.departsAt
            : a.departsAt - b.departsAt || a.arrivesAt - b.arrivesAt)
          .slice(0, 5)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error('Digitransiti teekonnaotsing ebaõnnestus:', error)
        routingError.value = 'Digitransiti teekonnaotsing ebaõnnestus. Proovi uuesti või kontrolli API seadistust.'
      }
    } finally {
      if (!controller.signal.aborted) routingLoading.value = false
    }
  },
  { immediate: true },
)
const trips = computed(() => matchItineraryVehicles(
  itineraryResults.value,
  props.data,
  props.vehicles,
  trackedVehicles.value,
).map((trip) => ({ ...trip, isHistorical: isHistoricalView.value })))

function tripSelectionKey(trip) {
  return `${trip.id}-${trip.departsAt.getTime()}`
}

function rememberVehicles(trip) {
  const updated = new Map(trackedVehicles.value)
  let changed = false
  for (const leg of trip.legs) {
    if (leg.vehicle && !updated.has(leg.trackingKey)) {
      updated.set(leg.trackingKey, {
        vehicleId: leg.vehicle.vehicleId,
        line: leg.vehicle.line,
        transportType: leg.vehicle.transportType,
      })
      changed = true
    }
  }
  if (changed) trackedVehicles.value = updated
}

watch(trips, (updatedTrips) => {
  const selected = updatedTrips.find((trip) => tripSelectionKey(trip) === selectedTripId.value)
  if (selected) rememberVehicles(selected)
})
const invalidPlaces = computed(() => !fromStop.value || !toStop.value)
const scheduleNote = 'Teekonnad: Digitransit. Tallinna GPS-i põhine hilinemine on hinnanguline.'

function clearSelection() {
  selectedTripId.value = null
  trackedVehicles.value = new Map()
}

function toggleSearch() {
  searchExpanded.value = !searchExpanded.value
  if (!searchExpanded.value) clearSelection()
}

function toggleTrip(trip) {
  const key = tripSelectionKey(trip)
  if (selectedTripId.value === key) {
    clearSelection()
    return
  }
  trackedVehicles.value = new Map()
  rememberVehicles(trip)
  selectedTripId.value = key
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
  return trip.routeLegs.map((leg) => `minmax(0, ${Math.max(0.01, leg.durationMinutes)}fr)`).join(' ')
}

function cardDepartureText(trip) {
  const stopName = stopLabel(trip.from)
  if (trip.isWalkingOnly) return 'Kõnni sihtkohta'
  const liveDeparture = trip.legs[0].estimatedDepartureAt
  if (trip.legs[0].isLive && liveDeparture) {
    return `Graafik ${formatClock(trip.legs[0].departsAt)} · GPS-hinnang ${formatClock(liveDeparture)} · ${stopName}`
  }
  const verb = trip.legs[0].departsAt.getTime() < Date.now() - 60_000 ? 'Väljus' : 'Väljub'
  return `${verb} ${formatClock(trip.legs[0].departsAt)} peatusest ${stopName}`
}

function legDelayText(leg) {
  const delay = leg?.estimatedDelayMinutes
  if (delay === null || delay === undefined) return ''
  if (Math.abs(delay) <= 1) return 'GPS-hinnang: graafikus'
  return `GPS-hinnang: ${Math.abs(delay)} min ${delay > 0 ? 'hilineb' : 'varem'}`
}

</script>

<template>
  <section class="planner">
    <div class="planner-hero">
      <div class="journey-search">
      <div class="place-inputs" @focusin="searchExpanded = true">
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

      <button class="search-toggle" type="button" :aria-expanded="searchExpanded" @click="toggleSearch">
        {{ searchExpanded ? 'Peida reisivalikud' : 'Vaata reisivõimalusi' }}
        <span aria-hidden="true">{{ searchExpanded ? '⌃' : '⌄' }}</span>
      </button>
      <div v-show="searchExpanded" class="time-panel">
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
    </div>

    <div v-show="searchExpanded">
    <p v-if="locationMessage" class="location-message" role="status">{{ locationMessage }}</p>
    <p v-else class="schedule-note">{{ scheduleNote }}</p>

    <div v-if="invalidPlaces" class="planner-message">
      Vali loendist kehtiv algus- ja sihtpunkt.
    </div>
    <div v-else-if="fromStop.id === toStop.id && !userLocation" class="planner-message">
      Algus- ja sihtpunkt peavad olema erinevad.
    </div>
    <div v-else-if="routingLoading" class="planner-message" role="status">
      Otsin teekondi…
    </div>
    <div v-else-if="routingError" class="planner-message" role="alert">
      {{ routingError }} <button type="button" class="retry-routing" @click="routingAttempt++">Proovi uuesti</button>
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
            @click="toggleTrip(trip)"
          >
            <span class="trip-card-top">
              <strong>{{ cardTimeText(trip) }}</strong>
              <strong>{{ trip.durationMinutes }} min</strong>
            </span>
            <span class="route-track" :style="{ gridTemplateColumns: routeTrackColumns(trip) }">
              <template v-for="(leg, legIndex) in trip.routeLegs" :key="`${legIndex}-${leg.departsAt.getTime()}`">
                <span v-if="leg.type === 'walk'" class="walk-chip" :title="`Kõnd ${leg.durationMinutes} min`">
                  ♙<small>{{ leg.durationMinutes }}</small>
                </span>
                <span v-else class="route-line-chip" :class="leg.transportType" :title="`Liin ${leg.line} · ${leg.durationMinutes} min`">
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
            </span>
            <span class="trip-card-bottom">
              <span>{{ cardDepartureText(trip) }}</span>
              <span class="trip-chevron" aria-hidden="true">›</span>
            </span>
          </button>

          <div v-if="selectedTripId === `${trip.id}-${trip.departsAt.getTime()}`" class="trip-detail">
            <div class="map-caption">
              <strong>Teekond kaardil</strong>
              <span>{{ trip.isWalkingOnly ? 'Kõnniteekond · Digitransit' : trip.legs.some((leg) => leg.isLive && !leg.isSimulated) ? 'GPS-asukoht · hinnanguline vaste' : 'Digitransiti teekond · GPS-sõidukit ei ole tuvastatud' }}</span>
            </div>
            <LiveMap v-if="active" :stops="stops" :vehicles="vehicles" :trip="trip" :user-location="userLocation" />
            <div class="detail-summary">
              <span>◷ {{ trip.durationMinutes }} min</span>
              <span v-if="trip.walkMinutes">♙ {{ trip.walkMinutes }} min kõndi</span>
              <span v-if="trip.transferMinutes">↔ {{ trip.transferMinutes }} min ümberistumiseks</span>
              <span>{{ formatDate(trip.departsAt) }} · {{ formatClock(trip.departsAt) }}–{{ formatClock(trip.arrivesAt) }}</span>
            </div>
            <div v-if="trip.legs.some((leg) => leg.isLive)" class="leg-live-info">
              <span v-for="leg in trip.legs.filter((item) => item.isLive)" :key="leg.tripId">
                Liin {{ leg.line }} · {{ legDelayText(leg) || 'GPS-asukoht olemas; hilinemine teadmata' }}
              </span>
            </div>
            <div v-if="trip.legs.some((leg) => leg.transportType === 'county')" class="county-live-info">
              <span>Maakonnabussi hilinemine pole siin teada<span v-if="trip.legs.length > 1">; ümberistumine on sõiduplaani järgi</span>.</span>
              <a
                v-for="leg in trip.legs.filter((item) => item.transportType === 'county' && item.routeId?.startsWith('county:'))"
                :key="leg.routeId"
                :href="countyRealtimeUrl(leg.routeId)"
                target="_blank"
                rel="noopener noreferrer"
              >Vaata liini {{ leg.line }} asukohta Peatus.ee-s ↗</a>
            </div>
            <p v-if="trip.legs.some((leg) => ['bus', 'tram', 'trolley'].includes(leg.transportType))" class="tracking-note">
              GPS-sõiduk on hinnanguline: sõidu tunnus puudub. Valitud sõidukit ei vahetata automaatselt;
              kui selle asukoht pole saadaval, ei näidata teist sama liini sõidukit.
            </p>
            <ol class="journey-steps">
              <li
                v-for="(step, index) in journeyTimeline(trip, null, expandedLegs)"
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
                </span>
              </li>
            </ol>
          </div>
        </article>
      </div>

      <button class="paging-button later-button" type="button" @click="adjustTime(30)">
        <span aria-hidden="true">⌄</span> Hiljem
      </button>
    </template>
    </div>
  </section>
</template>

<style scoped>
.planner { width: 100%; min-width: 0; }
.planner-hero { position: relative; }
.journey-search { position: relative; z-index: 1; overflow: visible; padding: 18px; border: 1px solid #526453; border-radius: 26px; background: #1b251e; box-shadow: 0 16px 38px #0005; }
.place-inputs { position: relative; display: grid; gap: 10px; }
.search-toggle { display: flex; width: 100%; min-height: 44px; align-items: center; justify-content: space-between; margin-top: 10px; padding: 8px 14px; border: 0; border-radius: 14px; color: #d7f6a8; background: #293a2b; cursor: pointer; font-size: 14px; font-weight: 600; }
.search-toggle:hover { background: #374c39; }
.search-toggle span { font-size: 20px; }
.current-location-button { padding: 9px 10px; border: 0; color: #d7f6a8; background: transparent; cursor: pointer; font-size: 13px; white-space: nowrap; }
.current-location-button:disabled { opacity: .7; cursor: wait; }
.swap-button { position: absolute; z-index: 5; top: 41px; left: 19px; width: 32px; height: 32px; border: 1px solid #627361; border-radius: 50%; color: #e7f0e2; background: #303e32; cursor: pointer; font-size: 17px; }
.time-panel { position: relative; display: grid; gap: 12px; margin-top: 14px; padding: 14px; border: 1px solid #455648; border-radius: 19px; background: #29362bcc; }
.close-time-panel { position: absolute; top: 3px; right: 7px; padding: 0; border: 0; color: #c7d0c8; background: transparent; cursor: pointer; font-size: 23px; line-height: 1; }
.time-panel-top { display: flex; align-items: center; gap: 10px; padding-right: 20px; }
.mode-switch { display: flex; padding: 3px; border-radius: 999px; background: #18231b; }
.mode-switch button { min-width: 84px; min-height: 38px; padding: 8px 12px; border: 0; border-radius: 999px; color: #e3e7e3; background: transparent; cursor: pointer; font-size: 14px; }
.mode-switch button.active { color: #1b2b1d; background: #d7f6a8; }
.leave-now-button { min-height: 40px; padding: 8px 15px; border: 1px solid #718574; border-radius: 999px; color: #f0f3f0; background: transparent; cursor: pointer; font-size: 14px; }
.date-time-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, .58fr); gap: 8px; }
.date-field, .time-field { display: flex; min-width: 0; height: 46px; align-items: center; gap: 9px; padding: 0 13px; border: 1px solid #60715f; border-radius: 14px; background: #18221b; }
.date-field > span, .time-field > span { color: #d7f6a8; font-size: 17px; }
.date-field input, .time-field input { width: 100%; min-width: 0; border: 0; outline: 0; color: #f1f3f1; background: transparent; font-size: 14px; }
.date-field input::-webkit-calendar-picker-indicator, .time-field input::-webkit-calendar-picker-indicator { filter: invert(.9); }
.schedule-note, .location-message { margin: 10px 2px 0; color: #a4ada5; font-size: 12px; line-height: 1.5; }
.location-message { color: #c3dfa8; }
.retry-routing { margin-left: 6px; border: 0; color: var(--green); background: transparent; cursor: pointer; font: inherit; text-decoration: underline; }
.results-toolbar { display: flex; justify-content: space-between; margin: 28px 5px 12px; color: #bdc9bc; font-size: 14px; }
.paging-button { display: flex; width: 100%; min-height: 44px; align-items: center; gap: 10px; padding: 10px 17px; border: 1px solid #405044; border-radius: 16px; color: #d9e3d7; background: #1c271e; cursor: pointer; font-size: 14px; text-align: left; }
.paging-button:hover { color: #fff; background: #304033; }
.paging-button span { font-size: 20px; line-height: 1; }
.trip-list { display: grid; gap: 10px; margin: 10px 0; }
.trip-entry { overflow: hidden; border: 1px solid #455648; border-radius: 22px; background: #1b251eeb; }
.trip-entry-selected { border-color: #708966; }
.trip-card { display: grid; width: 100%; gap: 11px; padding: 17px; border: 0; color: inherit; background: transparent; cursor: pointer; text-align: left; }
.trip-card:hover, .trip-entry-selected .trip-card { background: #2b3b2e; }
.trip-card-top, .trip-card-bottom { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.trip-card-top strong { color: #f1f4f1; font-size: 18px; }
.trip-card-top strong:last-child { color: #d7f6a8; white-space: nowrap; }
.route-track { display: grid; min-width: 0; height: 33px; align-items: stretch; gap: 4px; }
.route-line-chip { display: flex; min-width: 0; overflow: hidden; align-items: center; gap: 6px; padding: 0 10px; border-radius: 9px; color: #08251e; background: #00c99a; font-size: 14px; font-weight: 700; white-space: nowrap; }
.route-line-chip.tram { color: #2a1008; background: #ff642e; }
.route-line-chip.trolley { color: #fff; background: #174d9b; }
.route-line-chip.county { color: #3b2109; background: #ffbf80; }
.route-line-chip.rail { color: #241747; background: #c4b5fd; }
.transport-icon { width: 18px; height: 18px; flex: 0 0 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.walk-chip { display: flex; min-width: 0; overflow: hidden; align-items: center; justify-content: center; gap: 3px; border-radius: 9px; color: #e6ece3; background: #526055; font-size: 16px; white-space: nowrap; }
.walk-chip small { font-size: 11px; }
.trip-card-bottom { color: #c6d1c5; font-size: 14px; }
.trip-chevron { color: #d7f6a8; font-size: 28px; line-height: 20px; }
.trip-detail { padding: 16px; border-top: 1px solid #526453; background: #172019; }
.detail-summary { display: flex; flex-wrap: wrap; gap: 14px; margin: 18px 4px 14px; color: #cbd6c9; font-size: 13px; }
.leg-live-info { display: grid; gap: 6px; margin: 0 4px 15px; color: #b7f36b; font-size: 12px; }
.county-live-info { display: grid; gap: 6px; margin: 0 4px 15px; color: #c2cbc3; font-size: 12px; line-height: 1.4; }
.county-live-info a { color: #d7f6a8; }
.tracking-note { margin: 0 4px 15px; color: #c2cbc3; font-size: 12px; line-height: 1.4; }
.journey-steps { display: grid; margin: 0; padding: 0; list-style: none; }
.journey-step { position: relative; display: grid; min-height: 60px; grid-template-columns: 48px 20px minmax(0, 1fr); align-items: start; gap: 8px; padding: 9px 0; }
.journey-step:not(:last-child)::after { position: absolute; top: 25px; bottom: -9px; left: 64px; border-left: 4px solid #838c84; content: ''; }
.journey-step-toggle:not(:last-child)::after { top: 9px; }
.journey-step.connection-bus::after { border-color: #00c99a; }
.journey-step.connection-tram::after { border-color: #ff642e; }
.journey-step.connection-trolley::after { border-color: #174d9b; }
.journey-step.connection-county::after { border-color: #ffbf80; }
.journey-step.connection-rail::after { border-color: #c4b5fd; }
.journey-step.connection-walk::after { border-left-style: dotted; border-color: #a8b1a9; }
.journey-step.connection-wait::after { border-color: #838c84; }
.timeline-marker { z-index: 1; width: 18px; height: 18px; border: 4px solid #a8b1a9; border-radius: 50%; background: #172019; }
.marker-bus { border-color: #00c99a; }
.marker-tram { border-color: #ff642e; }
.marker-trolley { border-color: #174d9b; }
.marker-county { border-color: #ffbf80; }
.marker-rail { border-color: #c4b5fd; }
.marker-origin, .marker-destination { border-width: 5px; background: #fff; }
.marker-origin { border-color: #69ae19; }
.marker-destination { border-color: #fa729a; }
.timeline-action { z-index: 1; display: grid; width: 20px; height: 24px; place-items: center; color: #c6cec7; background: #172019; }
.timeline-action svg { width: 20px; height: 20px; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.wait-action { font-size: 23px; line-height: 1; }
.journey-step time { padding-top: 1px; color: #d4dad4; font-size: 13px; font-variant-numeric: tabular-nums; }
.step-copy { display: grid; gap: 5px; min-width: 0; }
.step-copy strong { color: #eff2ef; font-size: 15px; font-weight: 500; }
.step-copy small { color: #a8b1a9; font-size: 12px; line-height: 1.4; }
.stops-toggle { grid-column: 3 / -1; display: flex; min-width: 0; min-height: 42px; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 3px 5px 0; border: 0; color: #d7f6a8; background: transparent; cursor: pointer; font-size: 14px; text-align: left; }
.stops-toggle:hover { color: #edffd4; }
.stops-toggle:focus-visible { outline: 2px solid #d7f6a8; outline-offset: 2px; }
.stops-duration { color: #a8b1a9; white-space: nowrap; }
.stops-chevron { font-size: 23px; line-height: 1; }
.map-caption { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 0 0 10px; }
.map-caption strong { font-size: 16px; }
.map-caption span { color: #a8b1a9; font-size: 11px; }
.planner-message { margin-top: 18px; padding: 16px; border: 1px solid #353c36; border-radius: 8px; color: #c2cbc3; background: #171b18; font-size: 14px; line-height: 1.5; }
.later-button { justify-content: center; color: #d7f6a8; }

@media (max-width: 600px) {
  .journey-search { padding: 12px; }
  .current-location-button { padding: 7px 5px; font-size: 12px; }
  .time-panel { padding: 12px; }
  .mode-switch button { min-width: 72px; padding: 8px 9px; font-size: 13px; }
  .leave-now-button { padding: 8px 10px; font-size: 13px; }
  .date-time-fields { grid-template-columns: minmax(0, 1fr) minmax(108px, .65fr); }
  .date-field, .time-field { gap: 5px; padding: 0 6px; }
  .date-field input, .time-field input { font-size: 14px; }
  .trip-card-top strong { font-size: 17px; }
  .trip-card-bottom { font-size: 13px; }
  .journey-step { grid-template-columns: 42px 20px minmax(0, 1fr); gap: 6px; }
  .journey-step:not(:last-child)::after { left: 56px; }
  .map-caption { align-items: flex-start; flex-direction: column; gap: 4px; }
}
</style>
