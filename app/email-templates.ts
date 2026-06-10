// Plantillas de correo EDITABLES por el comerciante.
//
// Este archivo es CLIENTE-SEGURO (no importa nada de servidor) a propósito:
// lo usa tanto `notify.server.ts` (para enviar) como `app.configuracion.tsx`
// (para mostrar un preview en vivo IDÉNTICO al correo real). Si cambias el
// layout aquí, el preview y el correo enviado cambian juntos.
//
// Las plantillas se guardan dentro del metafield JSON de config
// (namespace $app:flouvia, key "config") en la sección `emails`.

// ---------- Tipos ----------

export type EmailTpl = {
  asunto: string;
  encabezado: string;
  mensaje: string;
};

export type EmailsConfig = {
  // Confirmación automática al COMPRADOR cuando llega su solicitud.
  clienteRecibido: EmailTpl;
  // Aviso al VENDEDOR de que hay una nueva solicitud.
  adminNueva: EmailTpl;
  // Correo al COMPRADOR cuando le envías la cotización con link de pago.
  clienteCotizacion: EmailTpl;
};

export type EmailKey = keyof EmailsConfig;

// ---------- Defaults (copys iniciales) ----------

export const DEFAULTS_EMAILS: EmailsConfig = {
  clienteRecibido: {
    asunto: "Recibimos tu solicitud de cotización {{folio}}",
    encabezado: "¡Recibimos tu solicitud!",
    mensaje:
      "Hola {{cliente}},\n\n" +
      "Tu solicitud de cotización {{folio}} fue recibida por {{tienda}}. " +
      "Estamos revisando los productos y precios.\n\n" +
      "Te contactaremos muy pronto con tu cotización y el link de pago.",
  },
  adminNueva: {
    asunto: "Nueva solicitud de cotización {{folio}}",
    encabezado: "Nueva solicitud de cotización",
    mensaje:
      "Recibiste una nueva solicitud desde tu tienda: {{folio}}.\n\n" +
      "Entra a tu app Cotizaciones B2B MX para asignar precios y enviar el link de pago.",
  },
  clienteCotizacion: {
    asunto: "Tu cotización {{folio}} está lista",
    encabezado: "Tu cotización está lista",
    mensaje:
      "Hola {{cliente}},\n\n" +
      "Preparamos tu cotización {{folio}} por un total de {{total}}.\n\n" +
      "Usa el botón de abajo para revisar el detalle y completar tu pago de forma segura.",
  },
};

// ---------- Variables disponibles por correo (para la UI) ----------

export type VarDef = { token: string; etiqueta: string };

export const VARIABLES_POR_CORREO: Record<EmailKey, VarDef[]> = {
  clienteRecibido: [
    { token: "{{cliente}}", etiqueta: "Nombre del cliente" },
    { token: "{{tienda}}", etiqueta: "Nombre de tu tienda" },
    { token: "{{folio}}", etiqueta: "Folio (ej. #D001)" },
  ],
  adminNueva: [
    { token: "{{folio}}", etiqueta: "Folio (ej. #D001)" },
    { token: "{{cliente}}", etiqueta: "Nombre del cliente" },
  ],
  clienteCotizacion: [
    { token: "{{cliente}}", etiqueta: "Nombre del cliente" },
    { token: "{{tienda}}", etiqueta: "Nombre de tu tienda" },
    { token: "{{folio}}", etiqueta: "Folio (ej. #D001)" },
    { token: "{{total}}", etiqueta: "Total de la cotización" },
  ],
};

export const ETIQUETAS_CORREO: Record<EmailKey, { titulo: string; sub: string }> =
  {
    clienteRecibido: {
      titulo: "Confirmación al cliente",
      sub: "Se envía automáticamente al comprador cuando manda su solicitud desde la tienda.",
    },
    adminNueva: {
      titulo: "Aviso para ti (vendedor)",
      sub: "Te llega a ti cada vez que entra una nueva solicitud, para responder rápido.",
    },
    clienteCotizacion: {
      titulo: "Cotización enviada al cliente",
      sub: "Se envía al comprador cuando le mandas la cotización con el link de pago.",
    },
  };

// ---------- Render ----------

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Reemplaza {{var}} en texto plano (para el asunto). Sin escape de HTML.
function renderText(plantilla: string, vars: Record<string, string>): string {
  let out = plantilla ?? "";
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v ?? "");
  }
  return out.trim();
}

// Reemplaza {{var}} escapando TODO (texto del comerciante + valores) para HTML.
// Devuelve una sola línea (para encabezados).
function renderInline(plantilla: string, vars: Record<string, string>): string {
  let out = escapeHtml(plantilla ?? "");
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(escapeHtml(v ?? ""));
  }
  return out;
}

// Igual que renderInline pero convierte saltos de línea en párrafos/<br>.
function renderBody(plantilla: string, vars: Record<string, string>): string {
  const inline = renderInline(plantilla, vars);
  const parrafos = inline
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#44474f;">${p.replace(
          /\n/g,
          "<br/>",
        )}</p>`,
    )
    .join("");
  return parrafos;
}

export type CTA = { texto: string; url: string };
export type FilaDato = { etiqueta: string; valor: string };

// Tabla simple etiqueta/valor (para el aviso al vendedor).
export function tablaDatos(filas: FilaDato[]): string {
  const visibles = filas.filter((f) => f.valor && f.valor.trim());
  if (visibles.length === 0) return "";
  const rows = visibles
    .map(
      (f) => `
        <tr>
          <td style="padding:7px 0;font-size:13px;color:#8a8f98;width:140px;vertical-align:top;">${escapeHtml(
            f.etiqueta,
          )}</td>
          <td style="padding:7px 0;font-size:14px;color:#16161a;font-weight:600;">${escapeHtml(
            f.valor,
          ).replace(/\n/g, "<br/>")}</td>
        </tr>`,
    )
    .join("");
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
      style="border-top:1px solid #ececf0;margin:8px 0 20px;border-collapse:collapse;">
      ${rows}
    </table>`;
}

// Layout minimalista (estilo transaccional Stripe/Linear). Todo inline para
// máxima compatibilidad con clientes de correo (Gmail recorta <style>).
function layout(opts: {
  tienda: string;
  encabezado: string;
  cuerpoHtml: string;
  cta?: CTA;
  extraHtml?: string;
}): string {
  const { tienda, encabezado, cuerpoHtml, cta, extraHtml } = opts;
  const eyebrow = tienda ? escapeHtml(tienda) : "Cotizaciones B2B MX";

  const botonHtml = cta
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
        <tr>
          <td style="border-radius:8px;background:#1a73e8;">
            <a href="${escapeHtml(cta.url)}"
              style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;
              color:#ffffff;text-decoration:none;border-radius:8px;">
              ${escapeHtml(cta.texto)}
            </a>
          </td>
        </tr>
      </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 16px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0"
        style="max-width:480px;width:100%;background:#ffffff;border:1px solid #e8e8ec;
        border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;">
        <tr><td style="padding:32px 32px 28px;">
          <div style="font-size:13px;font-weight:600;color:#8a8f98;letter-spacing:.01em;margin-bottom:18px;">
            ${eyebrow}
          </div>
          <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:600;color:#16161a;letter-spacing:-0.01em;">
            ${encabezado}
          </h1>
          ${cuerpoHtml}
          ${extraHtml ?? ""}
          ${botonHtml}
        </td></tr>
        <tr><td style="padding:0 32px;"><div style="border-top:1px solid #ececf0;"></div></td></tr>
        <tr><td style="padding:18px 32px 26px;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#9a9fa8;">
            Este correo fue enviado por ${eyebrow} a través de Cotizaciones B2B MX.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Construye {subject, html} a partir de una plantilla + datos. Lo usan tanto
// el servidor (al enviar) como la UI (preview).
export function construirCorreo(opts: {
  tpl: EmailTpl;
  vars: Record<string, string>;
  tienda: string;
  cta?: CTA;
  extraHtml?: string;
}): { subject: string; html: string } {
  const { tpl, vars, tienda, cta, extraHtml } = opts;
  return {
    subject: renderText(tpl.asunto, vars),
    html: layout({
      tienda,
      encabezado: renderInline(tpl.encabezado, vars),
      cuerpoHtml: renderBody(tpl.mensaje, vars),
      cta,
      extraHtml,
    }),
  };
}

// Combina plantillas guardadas con los defaults (por si falta alguna llave).
export function mergeEmails(raw: any): EmailsConfig {
  const c = raw && typeof raw === "object" ? raw : {};
  const una = (k: EmailKey): EmailTpl => ({
    ...DEFAULTS_EMAILS[k],
    ...(c[k] && typeof c[k] === "object" ? c[k] : {}),
  });
  return {
    clienteRecibido: una("clienteRecibido"),
    adminNueva: una("adminNueva"),
    clienteCotizacion: una("clienteCotizacion"),
  };
}
