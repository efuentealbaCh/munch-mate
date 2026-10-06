import { escapeHtml, renderEmail } from "./templates";

const url = "https://munchmate.cl/verificar-email?token=abc&x=1";

describe("renderEmail", () => {
  it("renders the verification email with the link in both HTML and text", () => {
    const email = renderEmail({ template: "verify-email", data: { to: "ana@example.com", name: "Ana", url } });

    expect(email.subject).toMatch(/Confirma tu correo/);
    expect(email.html).toContain('href="https://munchmate.cl/verificar-email?token=abc&amp;x=1"');
    expect(email.text).toContain(url);
  });

  it("escapes the user's name in HTML so it cannot inject markup", () => {
    const email = renderEmail({
      template: "password-reset",
      data: { to: "x@example.com", name: '<img src=x onerror="alert(1)">', url },
    });

    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
