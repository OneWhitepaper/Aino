const titlebarHeight = 43
const trafficLightHeight = 14

/** Native coordinates and renderer chrome share one desktop band. */
export const desktopWindowChrome = {
  titlebarHeight,
  trafficLightHeight,
  trafficLightPosition: {
    x: 12,
    y: Math.round((titlebarHeight - trafficLightHeight) / 2)
  }
} as const
