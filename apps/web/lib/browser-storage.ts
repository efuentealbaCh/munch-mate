/**
 * Browser storage that may be missing or throw (Safari private mode, disabled storage, server render).
 * Every helper that receives these copes with undefined.
 */

export function sessionStore(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function localStore(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
