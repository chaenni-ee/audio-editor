export const fmt = (s: number) => {
  if (!isFinite(s)) s = 0
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `${m}:${r.toFixed(1).padStart(4, '0')}`
}
