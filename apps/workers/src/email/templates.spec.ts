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

describe("renderEmail staff-invitation", () => {
  it("lists the roles in Spanish and escapes the restaurant name", () => {
    const email = renderEmail({
      template: "staff-invitation",
      data: {
        to: "cocina@example.com",
        restaurantName: "Fuente <Alemana>",
        inviterName: "Ana",
        roles: ["kitchen", "cashier"],
        url: "https://munchmate.cl/invitacion?token=abc",
      },
    });

    expect(email.subject).toBe("Ana te invitó a Fuente <Alemana> en Munch Mate");
    expect(email.html).toContain("Fuente &lt;Alemana&gt;");
    expect(email.html).not.toContain("<Alemana>");
    expect(email.text).toContain("Cocina, Caja");
    expect(email.text).toContain("https://munchmate.cl/invitacion?token=abc");
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("renderEmail order-confirmation", () => {
  const data = {
    to: "ana@example.com",
    customerName: "Ana <b>",
    restaurantName: "Don Pepe",
    restaurantPhone: "+56 2 2345 6789",
    ticketNumber: 12,
    readyAt: "13:45",
    total: "$10.470",
    trackingUrl: "https://munchmate.cl/pedido#t=tok123",
    attachment: { key: "restaurants/r1/receipts/o1.pdf", filename: "comprobante-pedido-7.pdf" },
  };

  it("tells when to pick it up, links the tracking page and attaches the receipt", () => {
    const email = renderEmail({ template: "order-confirmation", data });

    expect(email.subject).toBe("Tu pedido #12 en Don Pepe fue aceptado");
    expect(email.text).toContain("aproximadamente a las 13:45");
    expect(email.text).toContain("https://munchmate.cl/pedido#t=tok123");
    expect(email.html).toContain('href="https://munchmate.cl/pedido#t=tok123"');
    expect(email.html).toContain("Ana &lt;b&gt;");
    expect(email.attachments).toEqual([{ ...data.attachment, contentType: "application/pdf" }]);
  });

  it("does not promise a time when none was set", () => {
    const email = renderEmail({ template: "order-confirmation", data: { ...data, readyAt: null, restaurantPhone: "" } });

    expect(email.text).toContain("Te avisaremos cuando esté listo.");
    expect(email.text).not.toContain("llama al local");
  });
});
