// In-memory safe-mode flag. It lives for the app session: it survives in-app
// navigation (Home remounts when you enter/leave a comic) but resets to ON on
// a full page reload or app restart, since the module is re-evaluated then.
let safeMode = true;

export function getSafeMode() {
  return safeMode;
}

export function setSafeMode(value) {
  safeMode = !!value;
}
