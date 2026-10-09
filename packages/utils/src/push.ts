/**
 * Push services of the browsers we support. A subscription's endpoint is chosen by the browser, but it reaches
 * the server as user input and the workers POST to it: only these hosts are accepted, so a forged
 * subscription cannot make the workers call internal services (SSRF).
 */
const PUSH_HOSTS: readonly (string | RegExp)[] = [
  "fcm.googleapis.com", // Chrome, Edge on Android, Samsung Internet
  "updates.push.services.mozilla.com", // Firefox
  /^[a-z0-9-]+\.push\.apple\.com$/, // Safari (web.push.apple.com and regional hosts)
  /^[a-z0-9-]+\.notify\.windows\.com$/, // Edge on Windows (WNS)
];

/** Whether a push subscription endpoint points to a known browser push service over HTTPS. */
export function isPushEndpointAllowed(endpoint: string): boolean {
  // https, then a plain dotted host (no user info, no port), then a path or the end. Parsed by hand: this
  // package runs in the api and the web without depending on either platform's URL types.
  const match = /^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/|$)/i.exec(endpoint);
  if (!match) return false;
  const hostname = match[1]!.toLowerCase();
  return PUSH_HOSTS.some((host) => (typeof host === "string" ? hostname === host : host.test(hostname)));
}
