// Random pacing gap between sends, in milliseconds.
export function pickDelayMs(
  minSeconds: number,
  maxSeconds: number,
  rand: () => number = Math.random,
): number {
  const min = Math.max(0, minSeconds)
  const max = Math.max(min, maxSeconds)
  return Math.round((min + (max - min) * rand()) * 1000)
}
