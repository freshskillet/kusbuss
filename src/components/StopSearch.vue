<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: String, required: true },
  options: { type: Array, required: true },
  label: { type: String, required: true },
  listId: { type: String, required: true },
  kind: { type: String, required: true },
})
const emit = defineEmits(['update:modelValue', 'select', 'edit'])
const open = ref(false)
const activeIndex = ref(-1)

const matches = computed(() => {
  const query = props.modelValue.trim().toLocaleLowerCase('et')
  if (!query) return { options: [], hasMore: false }
  const exact = []
  const startsWith = []
  const contains = []
  for (const option of props.options) {
    if (option.searchName === query || option.searchLabel === query) exact.push(option)
    else if (option.searchName.startsWith(query)) startsWith.push(option)
    else if (option.searchText.includes(query)) contains.push(option)
  }
  const options = [...exact, ...startsWith, ...contains]
  return { options: options.slice(0, 30), hasMore: options.length > 30 }
})

watch(() => props.modelValue, () => { activeIndex.value = -1 })

function choose(option) {
  emit('update:modelValue', option.label)
  emit('select', option.stop)
  open.value = false
  activeIndex.value = -1
}

function input(event) {
  emit('update:modelValue', event.target.value)
  emit('edit')
  open.value = true
}

function keydown(event) {
  if (event.key === 'Escape') {
    open.value = false
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!matches.value.options.length) return
    event.preventDefault()
    open.value = true
    const change = event.key === 'ArrowDown' ? 1 : -1
    activeIndex.value = activeIndex.value < 0
      ? (change > 0 ? 0 : matches.value.options.length - 1)
      : (activeIndex.value + change + matches.value.options.length) % matches.value.options.length
  } else if (event.key === 'Enter' && open.value && matches.value.options.length) {
    event.preventDefault()
    choose(matches.value.options[Math.max(0, activeIndex.value)])
  }
}
</script>

<template>
  <div class="stop-search">
    <div class="place-field">
      <span class="place-icon" :class="kind" aria-hidden="true">●</span>
      <input
        :value="modelValue"
        type="search"
        role="combobox"
        :aria-label="label"
        :placeholder="label"
        :aria-expanded="open && !!modelValue.trim()"
        :aria-controls="listId"
        :aria-activedescendant="open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined"
        aria-autocomplete="list"
        autocomplete="off"
        @input="input"
        @focus="open = true"
        @blur="open = false"
        @keydown="keydown"
      />
      <slot />
    </div>
    <div v-if="open && modelValue.trim()" class="suggestions">
      <ul :id="listId" role="listbox" :aria-label="`${label}: peatused`">
        <li
          v-for="(option, index) in matches.options"
          :id="`${listId}-${index}`"
          :key="option.stop.id"
          role="option"
          :aria-selected="index === activeIndex"
          :class="{ active: index === activeIndex }"
          @pointerdown.prevent
          @click="choose(option)"
        >{{ option.label }}</li>
      </ul>
      <p v-if="!matches.options.length" role="status">Selle nimega peatust ei leitud.</p>
      <p v-else-if="matches.hasMore">Täpsusta otsingut, et näha rohkem peatusi.</p>
    </div>
  </div>
</template>

<style scoped>
.stop-search { position: relative; min-width: 0; }
.stop-search:focus-within { z-index: 3; }
.place-field { display: flex; min-width: 0; height: 48px; align-items: center; gap: 10px; padding: 0 12px; border: 1px solid #737a74; border-radius: 7px; background: #111512; }
.place-field:focus-within { border-color: #b7f36b; }
.place-icon { width: 18px; flex: 0 0 18px; font-size: 15px; line-height: 1; text-align: center; }
.origin { color: #a4e271; }
.destination { color: #fa7c9f; }
.place-field input { width: 100%; min-width: 0; border: 0; outline: 0; color: #f0f3f0; background: transparent; font-size: 15px; }
.place-field input::placeholder { color: #9da69e; }
.suggestions { position: absolute; z-index: 4; top: 100%; right: 0; left: 0; max-height: 260px; overflow-y: auto; border: 1px solid #737a74; border-radius: 0 0 7px 7px; background: #171b18; box-shadow: 0 8px 18px #0008; }
.suggestions ul { margin: 0; padding: 0; list-style: none; }
.suggestions li { padding: 10px 12px; color: #f0f3f0; cursor: pointer; font-size: 14px; }
.suggestions li:hover, .suggestions li.active { background: #303d29; }
.suggestions p { margin: 0; padding: 12px; color: #aab3ab; font-size: 14px; }
@media (max-width: 600px) {
  .place-field { height: 45px; padding: 0 9px; }
  .place-field input { font-size: 14px; }
}
</style>
