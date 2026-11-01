// Set while the fixture replay is on screen (P-06): replay makes no requests, so every background poll that talks to /api
// waits until it is off screen. Kept in its own module so main.ts can read it without touching the panel (it is also
// safe to read before the panel exists).
export const isolation = {replay: false};
