// electron-log stand-in for the web build (aliased in vite.web.config.ts):
// plain console logging with the same printf-ish call shape.
/* eslint-disable no-console */
const make = (fn: (...args: unknown[]) => void) => (...args: unknown[]): void => fn(...args)
const logger = {
  info: make(console.info),
  warn: make(console.warn),
  error: make(console.error),
  debug: make(console.debug),
  verbose: make(console.debug),
  silly: make(console.debug),
  log: make(console.log),
  transports: { console: { level: 'info' }, ipc: { level: false } },
  scope: () => logger,
  errorHandler: { startCatching: (): void => {} },
}
export default logger
