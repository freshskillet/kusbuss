export function countyRealtimeUrl(routeId) {
  const id = routeId.slice('county:'.length)
  return `https://web.peatus.ee/linjat/estonia:${encodeURIComponent(id)}`
}
