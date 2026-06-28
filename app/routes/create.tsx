import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { notifyMerchantNewQuote } from "../notify.server";
import { mergeEmails } from "../email-templates";
import { evaluarLimite } from "../limites.server";

// Endpoint público del App Proxy.
// Shopify quita el prefijo+subpath, así que la tienda llama a
// /apps/flouvia-cotizaciones/create  →  tu app recibe  /create
export const action = async ({ request }: ActionFunctionArgs) => {
  // Verifica que la petición venga del App Proxy de Shopify (HMAC).
  const ctx: any = await authenticate.public.appProxy(request);
  const admin = ctx.admin;
  if (!admin) {
    return Response.json(
      { ok: false, error: "Tienda no autorizada." },
      { status: 401 },
    );
  }

  // Tope del Plan Gratis: si la tienda llegó al máximo, no aceptamos más
  // solicitudes desde la tienda (así el límite también aplica al storefront).
  const limite = await evaluarLimite(admin);
  if (limite.bloqueado) {
    return Response.json(
      {
        ok: false,
        error:
          "No pudimos registrar tu solicitud en este momento. Por favor contáctanos directamente para recibir tu cotización.",
      },
      { status: 403 },
    );
  }

  const body = await request.json();
  const lineItems = (body.lineItems ?? [])
    .filter((it: any) => it.variantId)
    .map((it: any) => ({
      variantId: `gid://shopify/ProductVariant/${it.variantId}`,
      quantity: Number(it.quantity) || 1,
    }));

  if (lineItems.length === 0) {
    return Response.json(
      { ok: false, error: "El carrito está vacío." },
      { status: 400 },
    );
  }

  // Solo campos B2B que NO existen en el checkout de Shopify.
  // Nombre/email/teléfono los captura el checkout cuando el cliente paga (regla 1.1.2).
  const company = body.company ? String(body.company).trim() : "";
  const rfc = body.rfc ? String(body.rfc).trim().toUpperCase() : "";
  const terminos = body.terminos ? String(body.terminos).trim() : "";
  const notes = body.notes ? String(body.notes).trim() : "";

  const customAttributes: { key: string; value: string }[] = [
    { key: "Origen", value: "Solicitud desde la tienda" },
  ];
  if (company) customAttributes.push({ key: "Empresa", value: company });
  if (rfc) customAttributes.push({ key: "RFC", value: rfc });
  if (terminos)
    customAttributes.push({ key: "Términos solicitados", value: terminos });
  if (notes) customAttributes.push({ key: "Notas del cliente", value: notes });

  // Exigimos sesión iniciada: el App Proxy incluye logged_in_customer_id en la
  // URL cuando el cliente está logueado. Los datos personales vienen de SU
  // cuenta de Shopify, NO de un formulario (regla 1.1.2). Sin sesión, no
  // creamos nada.
  const url = new URL(request.url);
  const loggedInId = url.searchParams.get("logged_in_customer_id");
  if (!loggedInId || loggedInId === "0") {
    return Response.json(
      {
        ok: false,
        error: "Inicia sesión para solicitar tu cotización.",
        needsLogin: true,
      },
      { status: 401 },
    );
  }

  const input: any = {
    lineItems,
    customAttributes,
    purchasingEntity: { customerId: `gid://shopify/Customer/${loggedInId}` },
  };

  const response = await admin.graphql(
    `#graphql
      mutation createQuoteFromStore($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { id name }
          userErrors { field message }
        }
      }`,
    { variables: { input } },
  );

  const json: any = await response.json();
  const errs = json.data?.draftOrderCreate?.userErrors ?? [];
  if (errs.length > 0) {
    return Response.json(
      { ok: false, error: errs.map((e: any) => e.message).join(", ") },
      { status: 400 },
    );
  }

  const quoteName = json.data?.draftOrderCreate?.draftOrder?.name;

  // Correos: el aviso al vendedor se envía en TODOS los planes (incluso Gratis),
  // porque si no le avisas que llegó una cotización, la app no sirve de nada.
  // La confirmación al comprador es solo desde Básico (plan de pago).
  try {
    const shopResp = await admin.graphql(
      `#graphql
        query shopEmail {
          shop {
            name
            email
            metafield(namespace: "$app:flouvia", key: "config") { value }
          }
        }`,
    );
    const shopJson: any = await shopResp.json();
    const shopName = shopJson.data?.shop?.name;

    let cfg: any = {};
    try {
      const raw = shopJson.data?.shop?.metafield?.value;
      if (raw) cfg = JSON.parse(raw);
    } catch {
      cfg = {};
    }
    const templates = mergeEmails(cfg.emails);
    const notif = cfg.notificaciones ?? {};
    const merchantEmail =
      (typeof notif.email === "string" && notif.email.trim()) ||
      shopJson.data?.shop?.email;
    const avisar = notif.avisarNuevaSolicitud !== false;

    // Aviso al vendedor — todos los planes (incluido Gratis).
    if (merchantEmail && avisar) {
      await notifyMerchantNewQuote({
        merchantEmail,
        quoteName,
        requesterName: "",
        requesterEmail: "",
        requesterPhone: "",
        company,
        rfc,
        terminos,
        notes,
        shopName,
        templates,
      });
    }
    // La confirmación automática al comprador requiere su email, que ya no
    // recopilamos en el widget (regla 1.1.2). El comprador recibe el link
    // de pago cuando el comerciante envía la cotización desde el admin.
  } catch {
    // No bloqueamos la cotización si el aviso falla.
  }

  return Response.json({ ok: true, name: quoteName });
};
