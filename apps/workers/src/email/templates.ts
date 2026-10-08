import { type EmailJob, RESTAURANT_ROLE_LABELS } from "@app/types";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  /** Files read from the private bucket and attached by the processor. */
  attachments?: { key: string; filename: string; contentType: string }[];
}

/** Escapes user-provided values (names) before inserting them into HTML. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Minimal, client-compatible layout: inline styles only, single column, plain-text alternative always sent. */
function layout(title: string, paragraphs: string[], action: { label: string; url: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${p}</p>`).join("");
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px">
      <h1 style="margin:0 0 24px;font-size:20px">${title}</h1>
      ${body}
      <p style="margin:24px 0">
        <a href="${escapeHtml(action.url)}" style="display:inline-block;background:#1f1f1f;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px">${action.label}</a>
      </p>
      <p style="margin:0;font-size:12px;color:#6b6b6b">Si el botón no funciona, copia este enlace en tu navegador:<br>${escapeHtml(action.url)}</p>
    </div>
  </body>
</html>`;
}

/**
 * Renders the subject, HTML and plain-text bodies of an email job.
 * Exhaustive over EmailJob: adding a template to @app/types without rendering it here fails to compile.
 */
export function renderEmail(job: EmailJob): RenderedEmail {
  switch (job.template) {
    case "verify-email": {
      const { name, url } = job.data;
      return {
        subject: "Confirma tu correo en Munch Mate",
        html: layout(
          `Hola ${escapeHtml(name)}`,
          ["Confirma tu correo para empezar a usar Munch Mate.", "El enlace vence en 24 horas."],
          { label: "Confirmar correo", url },
        ),
        text: `Hola ${name}:\n\nConfirma tu correo para empezar a usar Munch Mate:\n${url}\n\nEl enlace vence en 24 horas.`,
      };
    }
    case "password-reset": {
      const { name, url } = job.data;
      return {
        subject: "Restablece tu contraseña de Munch Mate",
        html: layout(
          `Hola ${escapeHtml(name)}`,
          [
            "Recibimos una solicitud para restablecer tu contraseña.",
            "El enlace vence en 24 horas. Si no fuiste tú, ignora este correo: tu contraseña no cambiará.",
          ],
          { label: "Restablecer contraseña", url },
        ),
        text: `Hola ${name}:\n\nPara restablecer tu contraseña abre este enlace:\n${url}\n\nVence en 24 horas. Si no fuiste tú, ignora este correo.`,
      };
    }
    case "staff-invitation": {
      const { restaurantName, inviterName, roles, url } = job.data;
      const roleList = roles.map((role) => RESTAURANT_ROLE_LABELS[role]).join(", ");
      return {
        subject: `${inviterName} te invitó a ${restaurantName} en Munch Mate`,
        html: layout(
          `Te invitaron a ${escapeHtml(restaurantName)}`,
          [
            `${escapeHtml(inviterName)} te invitó a sumarte al equipo de <strong>${escapeHtml(restaurantName)}</strong> con el rol: ${escapeHtml(roleList)}.`,
            "Si aún no tienes cuenta, podrás crearla con este mismo correo. La invitación vence en 24 horas.",
          ],
          { label: "Aceptar invitación", url },
        ),
        text: `${inviterName} te invitó a sumarte al equipo de ${restaurantName} (${roleList}) en Munch Mate.\n\nAcepta la invitación aquí:\n${url}\n\nSi aún no tienes cuenta, podrás crearla con este mismo correo. Vence en 24 horas.`,
      };
    }
    case "order-confirmation": {
      const { customerName, restaurantName, restaurantPhone, ticketNumber, readyAt, total, trackingUrl, attachment } =
        job.data;
      const when = readyAt ? `Estará listo para retirar aproximadamente a las ${readyAt}.` : "Te avisaremos cuando esté listo.";
      const call = restaurantPhone ? ` Si necesitas cambiar algo, llama al local: ${restaurantPhone}.` : "";
      return {
        subject: `Tu pedido #${ticketNumber} en ${restaurantName} fue aceptado`,
        html: layout(
          `Hola ${escapeHtml(customerName)}`,
          [
            `<strong>${escapeHtml(restaurantName)}</strong> aceptó tu pedido <strong>#${ticketNumber}</strong>. ${escapeHtml(when)}`,
            `Total: <strong>${escapeHtml(total)}</strong>. El pago se realiza en el local al retirar.${escapeHtml(call)}`,
            "Adjuntamos el comprobante en PDF (documento interno, no es una boleta).",
          ],
          { label: "Seguir mi pedido", url: trackingUrl },
        ),
        text:
          `Hola ${customerName}:\n\n${restaurantName} aceptó tu pedido #${ticketNumber}. ${when}\n\n` +
          `Total: ${total}. El pago se realiza en el local al retirar.${call}\n\n` +
          `Sigue tu pedido aquí:\n${trackingUrl}\n\nAdjuntamos el comprobante en PDF (documento interno, no es una boleta).`,
        attachments: [{ ...attachment, contentType: "application/pdf" }],
      };
    }
    default: {
      const unreachable: never = job;
      throw new Error(`No template for ${JSON.stringify(unreachable)}`);
    }
  }
}
