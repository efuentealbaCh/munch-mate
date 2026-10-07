// Jest setup (setupFiles). Testcontainers exposes containers as "localhost", which Node may resolve to
// ::1 first. Docker Desktop on Windows intermittently resets connections forwarded over IPv6, making
// tests flaky (ECONNRESET); IPv4 first avoids it and changes nothing on Linux/CI.
require("node:dns").setDefaultResultOrder("ipv4first");
