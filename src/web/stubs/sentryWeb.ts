// @sentry/electron/renderer stand-in for the web build: telemetry is a
// desktop-app concern; the web client logs to the console only.
export function init(_options?: unknown): void {}
export function captureException(_err: unknown, _ctx?: unknown): void {}
export function captureMessage(_msg: string): void {}
