<script setup>
import { computed, onMounted, ref } from 'vue'

const props = defineProps({
  stops: { type: Array, required: true },
  selectedStopId: { type: String, required: true },
})
const emit = defineEmits(['select-stop'])

const searchQuery = ref('')
const favoriteIds = ref([])
const locationMessage = ref('')
const isLocating = ref(false)

const searchableStops = computed(() => props.stops
  .map((stop) => ({
    stop,
    text: `${stop.name} ${stop.alias || ''} ${stop.area || ''} ${stop.platform || ''}`
      .toLocaleLowerCase('et'),
  }))
  .sort((a, b) => b.stop.routes.length - a.stop.routes.length || a.stop.name.localeCompare(b.stop.name, 'et')))

const filteredStops = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase('et')
  const limit = query ? 100 : 16
  const matches = []
  for (const entry of searchableStops.value) {
    if (entry.text.includes(query)) matches.push(entry.stop)
    if (matches.length === limit) break
  }
  return matches
})

onMounted(() => {
  try {
    const savedFavorites = window.localStorage.getItem('kusbuss-favorites')
    if (savedFavorites) {
      const parsed = JSON.parse(savedFavorites)
      if (Array.isArray(parsed)) favoriteIds.value = parsed
    }
  } catch (error) {
    console.warn('Lemmikpeatuste laadimine ebaõnnestus.', error)
  }
})

function toggleFavorite(stopId) {
  const updated = favoriteIds.value.includes(stopId)
    ? favoriteIds.value.filter((id) => id !== stopId)
    : [...favoriteIds.value, stopId]

  favoriteIds.value = updated
  try {
    window.localStorage.setItem('kusbuss-favorites', JSON.stringify(updated))
  } catch (error) {
    console.warn('Lemmikpeatuste salvestamine ebaõnnestus.', error)
  }
}

function findNearestStop() {
  locationMessage.value = ''
  if (!navigator.geolocation) {
    locationMessage.value = 'Sinu brauser ei toeta asukoha määramist.'
    return
  }

  isLocating.value = true
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const nearest = props.stops.reduce((closest, stop) => {
        const distance = Math.hypot(
          (stop.coordinates.lat - coords.latitude) * 111,
          (stop.coordinates.lon - coords.longitude) * 111 * Math.cos(coords.latitude * Math.PI / 180),
        )
        return !closest || distance < closest.distance ? { stop, distance } : closest
      }, null)
      if (nearest) {
        emit('select-stop', nearest.stop)
        locationMessage.value = `Lähim peatus: ${nearest.stop.name}`
      }
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
</script>

<template>
  <div class="selector-card">
    <label class="search-label" for="stop-search">LEIA PEATUS</label>
    <div class="search-field">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="10.8" cy="10.8" r="6.8" />
        <path d="m16 16 4 4" />
      </svg>
      <input id="stop-search" v-model="searchQuery" type="search" placeholder="Otsi peatuse nime..." autocomplete="off" />
      <kbd>/</kbd>
    </div>

    <button class="nearest-button" type="button" :disabled="isLocating" @click="findNearestStop">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z" />
        <circle cx="12" cy="9" r="2.3" />
      </svg>
      {{ isLocating ? 'Otsin asukohta…' : 'Leia lähim peatus' }}
      <span aria-hidden="true">→</span>
    </button>
    <p v-if="locationMessage" class="location-message" role="status">{{ locationMessage }}</p>

    <div class="stop-list-heading">
      <span>{{ searchQuery ? 'OTSINGUTULEMUSED' : 'SAGEDASED PEATUSED' }}</span>
      <span>{{ filteredStops.length }} / {{ stops.length }}</span>
    </div>
    <div v-if="filteredStops.length" class="stop-list">
      <div
        v-for="stop in filteredStops"
        :key="stop.id"
        class="stop-option"
        :class="{ selected: selectedStopId === stop.id }"
      >
        <button
          class="stop-select"
          type="button"
          :aria-current="selectedStopId === stop.id ? 'true' : undefined"
          @click="emit('select-stop', stop)"
        >
          <span class="stop-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M5 19V9a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10M5 14h14M9 10h6M9 17h.01M15 17h.01" />
            </svg>
          </span>
          <span class="stop-name">
            {{ stop.name }}
            <small>
              <span v-if="stop.platform">Platvorm {{ stop.platform }} · </span>
              {{ stop.routes.slice(0, 3).map((route) => `${route.line} → ${route.destination}`).join(' · ') }}
              <span v-if="stop.routes.length > 3"> · +{{ stop.routes.length - 3 }}</span>
              <span v-if="stop.area"> · {{ stop.area }}</span>
              <span v-if="stop.wheelchairBoarding === '1'"> · ligipääsetav</span>
              <span v-else-if="stop.wheelchairBoarding === '2'"> · ligipääsmatu</span>
            </small>
          </span>
          <span v-if="selectedStopId === stop.id" class="selected-indicator" aria-hidden="true"></span>
          <span v-else class="stop-spacer"></span>
        </button>
        <span class="favorite-wrap">
          <button
            class="favorite-button"
            :class="{ favorite: favoriteIds.includes(stop.id) }"
            type="button"
            :aria-label="favoriteIds.includes(stop.id) ? `Eemalda ${stop.name} lemmikutest` : `Lisa ${stop.name} lemmikuks`"
            :aria-pressed="favoriteIds.includes(stop.id)"
            @click="toggleFavorite(stop.id)"
          >★</button>
        </span>
      </div>
    </div>
    <p v-else class="empty-search">Selle nimega peatust ei leitud.</p>
  </div>
</template>

<style scoped>
.selector-card { padding: 19px; border: 1px solid #2a302c; border-radius: 16px; background: #171b18; }
.search-label, .stop-list-heading { display: flex; align-items: center; justify-content: space-between; color: #a2aaa3; font-size: 11px; font-weight: 700; letter-spacing: .6px; }
.search-field { display: flex; height: 44px; align-items: center; gap: 10px; margin-top: 10px; padding: 0 11px; border: 1px solid #343b36; border-radius: 10px; background: #111512; }
.search-field svg { width: 17px; flex: 0 0 17px; stroke: #8c958e; stroke-width: 1.7; stroke-linecap: round; }
.search-field input { width: 100%; min-width: 0; border: 0; outline: 0; color: #f5f7f5; background: transparent; font-size: 14px; }
.search-field input::placeholder { color: #777f79; }
.search-field kbd { display: grid; width: 19px; height: 20px; flex: 0 0 19px; place-items: center; border: 1px solid #343b36; border-radius: 5px; color: #808981; font-size: 11px; }
.nearest-button { display: flex; width: 100%; height: 44px; align-items: center; gap: 8px; margin-top: 9px; padding: 0 10px; border: 1px solid #374b2e; border-radius: 9px; color: #c8f49f; background: #202a1c; cursor: pointer; font-size: 14px; text-align: left; }
.nearest-button:disabled { opacity: .7; cursor: wait; }
.nearest-button svg { width: 15px; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.nearest-button span { margin-left: auto; font-size: 15px; }
.location-message { margin: 8px 0 0; color: #a6ca87; font-size: 12px; line-height: 1.4; }
.stop-list-heading { margin: 25px 2px 9px; }
.stop-list-heading span:last-child { color: #929a94; font-weight: 400; letter-spacing: 0; }
.stop-list { display: flex; flex-direction: column; gap: 4px; }
.stop-option { display: flex; width: 100%; min-height: 55px; align-items: center; gap: 4px; padding: 3px 4px 3px 7px; border: 1px solid transparent; border-radius: 10px; transition: background .16s ease, border-color .16s ease; }
.stop-option:hover { background: #1d221e; }
.stop-option.selected { border-color: #394a31; background: #20271e; }
.stop-select { display: flex; min-width: 0; flex: 1; align-items: center; gap: 10px; padding: 0; border: 0; background: transparent; cursor: pointer; text-align: left; }
.stop-select:focus-visible, .favorite-button:focus-visible { outline: 2px solid #b7f36b; outline-offset: 2px; }
.stop-icon { display: grid; width: 34px; height: 34px; flex: 0 0 34px; place-items: center; border-radius: 9px; color: #8e9b90; background: #242a25; }
.selected .stop-icon { color: #c5f58f; background: #303d29; }
.stop-icon svg { width: 19px; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.stop-name { flex: 1; color: #e2e7e2; font-size: 14px; font-weight: 600; }
.stop-name small { display: block; margin-top: 3px; color: #929a94; font-size: 11px; font-weight: 400; }
.selected-indicator { width: 6px; height: 6px; border-radius: 50%; background: #b7f36b; box-shadow: 0 0 8px #b7f36b70; }
.stop-spacer { width: 6px; }
.favorite-wrap { display: flex; width: 25px; height: 30px; flex: 0 0 25px; align-items: center; justify-content: center; }
.favorite-button { display: grid; width: 28px; height: 28px; place-items: center; padding: 0; border: 0; border-radius: 7px; color: #707971; background: transparent; cursor: pointer; font-size: 17px; transition: color .15s, background .15s; }
.favorite-button:hover { color: #d7ecb8; background: #303730; }
.favorite-button.favorite { color: #e6bf6e; }
.empty-search { margin: 16px 3px 5px; color: #9aa39b; font-size: 13px; }

@media (max-width: 760px) {
  .selector-card { padding: 15px; }
  .stop-list-heading { margin-top: 19px; }
  .stop-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
  .stop-option { gap: 2px; min-height: 58px; padding: 4px; }
  .stop-select { gap: 7px; }
  .stop-icon { width: 31px; height: 31px; flex-basis: 31px; }
  .stop-name { font-size: 13px; }
  .favorite-wrap { flex-basis: 24px; width: 24px; }
}
</style>
