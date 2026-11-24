<script setup>
defineProps({
  departures: { type: Array, required: true },
  isLoading: { type: Boolean, default: false },
  stopName: { type: String, required: true },
})

const typeNames = {
  bus: 'Buss',
  tram: 'Tramm',
  trolley: 'Troll',
  county: 'Maakond',
}

function formatClock(date) {
  return new Intl.DateTimeFormat('et-EE', { hour: '2-digit', minute: '2-digit' }).format(date)
}
</script>

<template>
  <div class="departure-board">
    <div class="board-table-head">
      <span>LIIN</span>
      <span>SIHTKOHT</span>
      <span>VÄLJUMINE</span>
    </div>
    <div v-if="isLoading && !departures.length" class="board-message">
      Otsin reaalaja väljumisi…
    </div>
    <div v-else-if="!departures.length" class="board-message">
      Peatusele {{ stopName }} ei ole hetkel väljumisi.
    </div>
    <div v-else class="departure-list">
      <article v-for="departure in departures" :key="departure.id" class="departure-row">
        <div class="route-cell">
          <span class="route-number" :class="departure.transportType">{{ departure.line }}</span>
          <span class="route-type">{{ typeNames[departure.transportType] || departure.transportType }}</span>
        </div>
        <div class="destination-cell">
          <span class="destination-name">{{ departure.destination }}</span>
          <span class="destination-meta">
            {{ departure.isLive ? (departure.isSimulated ? 'DEMO GPS · HINNANG' : 'LIVE GPS · HINNANG') : departure.transportType === 'county' ? 'MAAKONNA SÕIDUPLAAN' : 'TLT SÕIDUPLAAN' }}
            <span v-if="departure.estimatedDelayMinutes !== null && departure.estimatedDelayMinutes !== undefined">
              · {{ Math.abs(departure.estimatedDelayMinutes) <= 1
                ? 'graafikus'
                : `${Math.abs(departure.estimatedDelayMinutes)} min ${departure.estimatedDelayMinutes > 0 ? 'hilineb' : 'varem'}` }}
            </span>
          </span>
        </div>
        <div class="arrival-cell">
          <strong :class="{ immediate: departure.minutes === 0 }">
            {{ departure.minutes === 0 ? 'Kohe' : `${departure.minutes} min` }}
          </strong>
          <span class="arrival-distance">
            {{ formatClock(departure.scheduledAt) }}
            <template v-if="departure.isLive && departure.distance !== null">
              · {{ departure.distance < 1000 ? `${Math.round(departure.distance)} m` : `${(departure.distance / 1000).toFixed(1)} km` }}
            </template>
            <template v-else> · graafik</template>
          </span>
        </div>
      </article>
    </div>
    <div class="board-bottom">
      <span>{{ departures.length }} väljumist</span>
      <span class="realtime-key">Reaalaja GPS</span>
    </div>
  </div>
</template>

<style scoped>
.departure-board { overflow: hidden; border: 1px solid #2a302c; border-radius: 15px; background: #171b18; }
.board-table-head { display: grid; grid-template-columns: 86px minmax(0, 1fr) 92px; gap: 12px; padding: 15px 19px; border-bottom: 1px solid #2a302c; color: #929a94; font-size: 10px; font-weight: 700; letter-spacing: .7px; }
.board-table-head span:last-child { text-align: right; }
.departure-row { display: grid; min-height: 80px; grid-template-columns: 86px minmax(0, 1fr) 92px; align-items: center; gap: 12px; padding: 10px 19px; border-bottom: 1px solid #252b27; transition: background .15s ease; }
.departure-row:last-child { border-bottom: 0; }
.departure-row:hover { background: #1b201c; }
.route-cell { display: flex; align-items: center; gap: 8px; }
.route-number { display: grid; min-width: 40px; height: 38px; place-items: center; padding: 0 5px; border-radius: 7px; color: #07251d; background: #00c99a; font-family: inherit; font-size: 17px; font-weight: 700; }
.route-number.tram { color: #2a1008; background: #ff642e; }
.route-number.trolley { color: #fff; background: #174d9b; }
.route-number.county { color: #3b2109; background: #ffbf80; }
.route-type { color: #a1a9a2; font-size: 11px; }
.destination-cell { min-width: 0; }
.destination-name { display: block; overflow: hidden; color: #edf0ed; font-size: 15px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.destination-meta { display: block; margin-top: 6px; color: #9aa39b; font-size: 11px; letter-spacing: .2px; }
.arrival-cell { display: flex; align-items: flex-end; flex-direction: column; }
.arrival-cell strong { color: #d3f5b5; font-family: inherit; font-size: 18px; font-weight: 700; white-space: nowrap; }
.arrival-cell strong.immediate { color: #b7f36b; }
.arrival-distance { margin-top: 4px; color: #929a94; font-size: 11px; }
.board-bottom { display: flex; justify-content: space-between; padding: 14px 19px; border-top: 1px solid #2a302c; color: #929a94; background: #151916; font-size: 12px; }
.realtime-key { display: inline-flex; align-items: center; }
.board-message { display: flex; min-height: 128px; align-items: center; justify-content: center; color: #a2aaa3; font-size: 15px; }

@media (max-width: 540px) {
  .board-table-head, .departure-row { grid-template-columns: 61px minmax(0, 1fr) 76px; gap: 8px; padding-right: 12px; padding-left: 12px; }
  .board-table-head { padding-top: 13px; padding-bottom: 13px; font-size: 9px; letter-spacing: .4px; }
  .departure-row { min-height: 76px; }
  .route-cell { flex-direction: column; align-items: flex-start; gap: 3px; }
  .route-number { min-width: 34px; height: 32px; font-size: 15px; }
  .route-type { font-size: 10px; }
  .destination-name { font-size: 14px; }
  .destination-meta { font-size: 10px; }
  .arrival-cell strong { font-size: 16px; }
  .arrival-distance { font-size: 10px; }
  .board-bottom { padding-right: 13px; padding-left: 13px; }
}
</style>
