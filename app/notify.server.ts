// Envío de correos vía Resend (https://resend.com).
// Se activa solo si está configurada la variable de entorno RESEND_API_KEY;
// si no, no hace nada (no rompe el flujo).
//
// El CONTENIDO de los correos (asunto/encabezado/mensaje) es EDITABLE por el
// comerciante desde Configuración → pestaña "Correos". Las plantillas y el
// layout viven en `app/email-templates.ts` (archivo compartido cliente/servidor
// para que el preview en Configuración sea idéntico al correo real).
//
// NOTA: estos son avisos del Plan Pro. El gating al plan Pro se hace en quien
// llama (create.tsx / app.quotes.$id.tsx).

import {
  construirCorreo,
  tablaDatos,
  DEFAULTS_EMAILS,
  type EmailsConfig,
} from "./email-templates";

function fromAddr(): string {
  return process.env.RESEND_FROM || "Cotizaciones B2B MX <onboarding@resend.dev>";
}

async function enviar(payload: {
  to: string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY no configurada." };
  }
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddr(),
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
      }),
    });
    if (!resp.ok) {
      const detalle = await resp.text().catch(() => "");
      return { ok: false, error: detalle || "No se pudo enviar el correo." };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "No se pudo enviar el correo." };
  }
}

// ---------- 1) Aviso al VENDEDOR: nueva solicitud ----------

type NotifyOpts = {
  merchantEmail: string;
  quoteName: string;
  requesterName?: string;
  requesterEmail?: string;
  requesterPhone?: string;
  company?: string;
  rfc?: string;
  terminos?: string;
  notes?: string;
  shopName?: string;
  templates?: Partial<EmailsConfig>;
};

export async function notifyMerchantNewQuote(opts: NotifyOpts): Promise<void> {
  if (!opts.merchantEmail) return;

  const tpl = opts.templates?.adminNueva ?? DEFAULTS_EMAILS.adminNueva;
  const vars = {
    folio: opts.quoteName ?? "",
    cliente: opts.requesterName ?? "",
    tienda: opts.shopName ?? "",
  };

  // Tabla con los datos del solicitante (se añade automáticamente, no editable).
  const extraHtml = tablaDatos([
    { etiqueta: "Solicitante", valor: opts.requesterName ?? "" },
    { etiqueta: "Correo", valor: opts.requesterEmail ?? "" },
    { etiqueta: "Teléfono", valor: opts.requesterPhone ?? "" },
    { etiqueta: "Empresa", valor: opts.company ?? "" },
    { etiqueta: "RFC", valor: opts.rfc ?? "" },
    { etiqueta: "Términos solicitados", valor: opts.terminos ?? "" },
    { etiqueta: "Notas del cliente", valor: opts.notes ?? "" },
  ]);

  const { subject, html } = construirCorreo({
    tpl,
    vars,
    tienda: opts.shopName ?? "",
    extraHtml,
  });

  await enviar({
    to: [opts.merchantEmail],
    subject,
    html,
    replyTo: opts.requesterEmail || undefined,
  });
}

// ---------- 2) Confirmación al COMPRADOR: solicitud recibida ----------

type RequesterOpts = {
  requesterEmail: string;
  requesterName?: string;
  quoteName?: string;
  shopName?: string;
  templates?: Partial<EmailsConfig>;
};

export async function notifyRequesterQuoteReceived(
  opts: RequesterOpts,
): Promise<void> {
  if (!opts.requesterEmail || !opts.requesterEmail.includes("@")) return;

  const tpl = opts.templates?.clienteRecibido ?? DEFAULTS_EMAILS.clienteRecibido;
  const vars = {
    cliente: opts.requesterName ?? "",
    tienda: opts.shopName ?? "",
    folio: opts.quoteName ?? "",
  };

  const { subject, html } = construirCorreo({
    tpl,
    vars,
    tienda: opts.shopName ?? "",
  });

  await enviar({ to: [opts.requesterEmail], subject, html });
}

// ---------- 3) Cotización enviada al COMPRADOR (con link de pago) ----------

type QuoteSentOpts = {
  requesterEmail: string;
  requesterName?: string;
  quoteName?: string;
  shopName?: string;
  invoiceUrl: string;
  total?: string;
  templates?: Partial<EmailsConfig>;
};

export async function notifyRequesterQuoteSent(
  opts: QuoteSentOpts,
): Promise<{ ok: boolean; error?: string }> {
  if (!opts.requesterEmail || !opts.requesterEmail.includes("@")) {
    return { ok: false, error: "El cliente no tiene un correo válido." };
  }
  if (!opts.invoiceUrl) {
    return { ok: false, error: "La cotización no tiene link de pago." };
  }

  const tpl =
    opts.templates?.clienteCotizacion ?? DEFAULTS_EMAILS.clienteCotizacion;
  const vars = {
    cliente: opts.requesterName ?? "",
    tienda: opts.shopName ?? "",
    folio: opts.quoteName ?? "",
    total: opts.total ?? "",
  };

  const { subject, html } = construirCorreo({
    tpl,
    vars,
    tienda: opts.shopName ?? "",
    cta: { texto: "Ver y pagar mi cotización", url: opts.invoiceUrl },
  });

  return enviar({ to: [opts.requesterEmail], subject, html });
}

// ---------- 4) Aviso al VENDEDOR: cuota de CFDI (80% / 100%) ----------
// Correo operativo (NO editable): avisa que se acerca o agotó la cuota mensual
// de facturas incluidas, para que el excedente no lo tome por sorpresa.

type CuotaCfdiOpts = {
  merchantEmail: string;
  shopName?: string;
  plan: "pro" | "plus";
  nivel: 80 | 100;
  timbrados: number;
  limite: number;
  extra: number; // USD por factura adicional
};

export async function notifyMerchantCfdiQuota(
  opts: CuotaCfdiOpts,
): Promise<void> {
  if (!opts.merchantEmail || !opts.merchantEmail.includes("@")) return;

  const planLabel = opts.plan === "plus" ? "Plus" : "Pro";
  const tienda = opts.shopName ? ` · ${opts.shopName}` : "";

  const subject =
    opts.nivel === 100
      ? `⚠️ Agotaste tus ${opts.limite} facturas CFDI del mes${tienda}`
      : `📊 Vas al ${opts.nivel}% de tu cuota de facturas CFDI${tienda}`;

  const intro =
    opts.nivel === 100
      ? `Llegaste a las <strong>${opts.limite}</strong> facturas CFDI incluidas en tu Plan ${planLabel} este mes. A partir de ahora, cada factura adicional se cobra como excedente a <strong>$${opts.extra.toFixed(2)} USD</strong> y aparecerá en tu próximo cobro de Shopify.`
      : `Ya usaste <strong>${opts.timbrados}</strong> de las <strong>${opts.limite}</strong> facturas CFDI incluidas en tu Plan ${planLabel} este mes (${opts.nivel}%). Al pasar la cuota, cada factura extra cuesta <strong>$${opts.extra.toFixed(2)} USD</strong>.`;

  const tip =
    opts.plan === "pro"
      ? `<p style="color:#6b7280;font-size:14px;">¿Facturas mucho? El <strong>Plan Plus</strong> incluye 1000 facturas/mes y abarata el excedente a $0.10 USD. Puedes cambiar de plan desde la sección Planes.</p>`
      : "";

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e;">
      <div style="background:linear-gradient(135deg,#1a73e8,#4285f4);color:#fff;padding:20px 24px;border-radius:14px 14px 0 0;">
        <h2 style="margin:0;font-size:18px;">Facturación CFDI · Plan ${planLabel}</h2>
      </div>
      <div style="border:1px solid #ececf0;border-top:0;border-radius:0 0 14px 14px;padding:22px 24px;">
        <p style="font-size:15px;line-height:1.55;">${intro}</p>
        <p style="font-size:14px;color:#374151;">La cuota se reinicia automáticamente el día 1 del próximo mes.</p>
        ${tip}
      </div>
    </div>
  `;

  await enviar({ to: [opts.merchantEmail], subject, html });
}

// ---------- 5) Mensaje del comerciante hacia soporte de Flouvia ----------
// (Este NO es editable; es un correo interno de la app.)

type ContactoOpts = {
  shopName?: string;
  remitente: string; // email de quien escribe
  asunto: string;
  mensaje: string;
};

export async function sendContactMessage(
  opts: ContactoOpts,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO || "soporte@flouvia.com";

  if (!apiKey) {
    return {
      ok: false,
      error:
        "El envío de correo no está configurado todavía. Escríbenos directo a soporte@flouvia.com.",
    };
  }

  const html = `
    <h2>📨 Nuevo mensaje de contacto</h2>
    ${opts.shopName ? `<p><strong>Tienda:</strong> ${opts.shopName}</p>` : ""}
    <p><strong>Responder a:</strong> ${opts.remitente || "(no indicado)"}</p>
    <p><strong>Asunto:</strong> ${opts.asunto}</p>
    <hr />
    <p style="white-space: pre-wrap;">${opts.mensaje}</p>
  `;

  return enviar({
    to: [to],
    subject: `📨 Contacto · ${opts.asunto}${opts.shopName ? ` · ${opts.shopName}` : ""}`,
    html,
    replyTo: opts.remitente || undefined,
  });
}
