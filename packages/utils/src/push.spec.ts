import { isPushEndpointAllowed } from "./push";

describe("isPushEndpointAllowed", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc:xyz",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://web.push.apple.com/QGsP0",
    "https://wns2-db5p.notify.windows.com/w/?token=abc",
  ])("accepts %s", (endpoint) => {
    expect(isPushEndpointAllowed(endpoint)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc", // not https
    "https://fcm.googleapis.com:8443/fcm/send/abc", // explicit port
    "https://valkey:6379/", // internal service
    "https://127.0.0.1/push",
    "https://evil.com/fcm.googleapis.com",
    "https://fcm.googleapis.com.evil.com/x",
    "https://user:pass@fcm.googleapis.com/x",
    "not a url",
  ])("refuses %s", (endpoint) => {
    expect(isPushEndpointAllowed(endpoint)).toBe(false);
  });
});
