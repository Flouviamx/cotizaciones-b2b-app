import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { timbrarCFDI } from "../facturapi.server";
import { notifyRequesterQuoteSent } from "../notify.server";
import { mergeEmails } from "../email-templates";
import { PLANES_PRO, TODOS_LOS_PLANES } from "../plans";
import { registrarTimbrado } from "../cfdi-usage.server";
import { construirHTMLcotizacion, mergePdfMarca } from "../pdf-cotizacion";
import { BILLING_TEST } from "../billing.server";

// Formatea un monto en la moneda BASE de la tienda (shopMoney) con separadores
// de miles y el símbolo correcto. Shopify ya convirtió a la moneda del comerciante.
function formatoMoneda(amount: string | number, currency: string) {
  const n = Number(amount || 0);
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: currency || "MXN",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)} ${currency || ""}`.trim();
  }
}

// Mensaje del toast tras timbrar, incluyendo aviso de cuota/excedente CFDI.
function mensajeCFDI(uso?: {
  plan: "pro" | "plus" | null;
  timbrados: number;
  limite: number;
  cobradoExtra: boolean;
  montoCobrado: number;
  topeAlcanzado: boolean;
}): string {
  if (!uso || uso.plan == null) return "Factura CFDI generada";
  if (uso.topeAlcanzado) {
    return "CFDI generada. Alcanzaste el tope de excedente: aprueba subir el límite en Planes para seguir facturando extra.";
  }
  if (uso.cobradoExtra) {
    return `CFDI generada (${uso.timbrados}/${uso.limite}). Excedente: +$${uso.montoCobrado.toFixed(2)} USD.`;
  }
  return `Factura CFDI generada (${uso.timbrados}/${uso.limite} este mes)`;
}

function estadoLegible(status: string) {
  switch (status) {
    case "OPEN":
      return "Abierta";
    case "INVOICE_SENT":
      return "Enviada al cliente";
    case "COMPLETED":
      return "Pagada";
    default:
      return status;
  }
}

function estadoClase(status: string) {
  if (status === "INVOICE_SENT") return "sent";
  if (status === "COMPLETED") return "paid";
  return "open";
}


const CSS = `
.qd-wrap { max-width: 820px; margin: 0 auto; padding: 8px 16px 40px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; color: #1a1a2e; }
.qd-card { background:#fff; border:1px solid #ececf0; border-radius:16px; padding:22px; margin-bottom:16px; box-shadow:0 1px 3px rgba(0,0,0,.04); }
.qd-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; }
.qd-card h2 { font-size:16px; font-weight:700; margin:0 0 12px; }
.qd-head h2 { margin:0; }
.qd-muted { color:#6b7280; font-size:14px; margin:4px 0; }
.qd-status { font-size:12px; font-weight:700; padding:4px 11px; border-radius:999px; white-space:nowrap; }
.qd-status.open { background:#e8f0fe; color:#1a56c4; }
.qd-status.sent { background:#fef3c7; color:#92400e; }
.qd-status.paid { background:#dcfce7; color:#15803d; }
.qd-label { display:block; font-size:13px; font-weight:600; color:#374151; margin:12px 0 6px; }
.qd-input, .qd-select { width:100%; padding:11px 12px; border:1px solid #d8d8e0; border-radius:10px; font-size:14px; background:#fff; color:#1a1a2e; outline:none; box-sizing:border-box; }
.qd-input:focus, .qd-select:focus { border-color:#1a73e8; box-shadow:0 0 0 3px rgba(26,115,232,.15); }
.qd-grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; }
.qd-btn { display:inline-block; border:0; border-radius:11px; padding:11px 16px; font-size:14px; font-weight:700; cursor:pointer; margin-top:14px; text-align:center; text-decoration:none; }
.qd-btn.primary { background:linear-gradient(135deg,#1a73e8,#4285f4); color:#fff; }
.qd-btn.secondary { background:#eef2f7; color:#1a1a2e; }
.qd-btn.ghost { background:#fff; border:1.5px solid #1a73e8; color:#1a73e8; }
.qd-btn[disabled] { opacity:.6; cursor:default; }
.qd-item { border:1px solid #ececf0; border-radius:12px; padding:14px; margin-bottom:10px; }
.qd-item .it-title { font-weight:600; font-size:14px; margin-bottom:8px; }
.qd-fields { display:flex; gap:12px; flex-wrap:wrap; }
.qd-fields > div { flex:1; min-width:130px; }
.qd-rm { background:transparent; border:0; color:#dc2626; font-weight:600; font-size:13px; cursor:pointer; margin-top:8px; padding:0; }
.qd-success { background:#dcfce7; color:#15803d; border-radius:12px; padding:12px 14px; margin-top:14px; font-size:14px; font-weight:600; word-break:break-all; }
.qd-lock { background:linear-gradient(135deg,#f5f9ff,#eef5ff); border-color:#cfe0fc; }
.qd-actions { display:flex; gap:10px; flex-wrap:wrap; }
`;

// Lee los atributos actuales de la cotización y les aplica cambios, sin borrar
// los demás (draftOrderUpdate REEMPLAZA customAttributes, así que hay que mezclar).
async function mergeCustomAttributes(
  admin: any,
  id: string,
  updates: Record<string, string>,
) {
  const r = await admin.graphql(
    `#graphql
      query attrs($id: ID!) {
        draftOrder(id: $id) { customAttributes { key value } }
      }`,
    { variables: { id } },
  );
  const j: any = await r.json();
  const current = j.data?.draftOrder?.customAttributes ?? [];
  const map = new Map<string, string>(
    current.map((a: any) => [a.key, a.value]),
  );
  for (const [k, v] of Object.entries(updates)) map.set(k, v);
  return Array.from(map, ([key, value]) => ({ key, value }));
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, billing } = await authenticate.admin(request);
  const id = `gid://shopify/DraftOrder/${params.id}`;

  const proCheck = await billing.check({
    plans: PLANES_PRO as any,
    isTest: BILLING_TEST,
  });
  const hasPro = proCheck.hasActivePayment;

  const paidCheck = await billing.check({
    plans: TODOS_LOS_PLANES as any,
    isTest: BILLING_TEST,
  });
  const hasPaid = paidCheck.hasActivePayment;

  const response = await admin.graphql(
    `#graphql
      query getQuote($id: ID!) {
        shop {
          name
          metafield(namespace: "$app:flouvia", key: "config") { value }
        }
        draftOrder(id: $id) {
          id
          name
          status
          invoiceUrl
          customAttributes { key value }
          appliedDiscount { value valueType }
          customer { id displayName email }
          totalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first: 50) {
            edges {
              node {
                title
                quantity
                variant { id }
                originalUnitPriceSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }
      }`,
    { variables: { id } },
  );

  const json: any = await response.json();
  const quote = json.data?.draftOrder;
  if (!quote) {
    throw new Response("Cotización no encontrada", { status: 404 });
  }
  const shopName = json.data?.shop?.name ?? "";

  // Personalización del PDF (config.pdf del metafield de la app).
  let pdfMarca = mergePdfMarca(null);
  try {
    const raw = json.data?.shop?.metafield?.value;
    if (raw) pdfMarca = mergePdfMarca(JSON.parse(raw).pdf);
  } catch {
    // valor corrupto: usamos defaults
  }

  const lineItems = (quote.lineItems?.edges ?? []).map((e: any) => e.node);

  const custResp = await admin.graphql(
    `#graphql
      query getCustomers {
        customers(first: 50, sortKey: NAME) {
          edges { node { id displayName } }
        }
      }`,
  );
  const custJson: any = await custResp.json();
  const customers = (custJson.data?.customers?.edges ?? []).map(
    (e: any) => e.node,
  );

  let companies: any[] = [];
  if (hasPro) {
    try {
      const compResp = await admin.graphql(
        `#graphql
          query getCompanies {
            companies(first: 25) {
              edges {
                node {
                  id
                  name
                  mainContact { id }
                  locations(first: 1) { edges { node { id } } }
                }
              }
            }
          }`,
      );
      const compJson: any = await compResp.json();
      companies = (compJson.data?.companies?.edges ?? [])
        .map((e: any) => ({
          id: e.node.id,
          name: e.node.name,
          contactId: e.node.mainContact?.id,
          locationId: e.node.locations?.edges?.[0]?.node?.id,
        }))
        .filter((c: any) => c.contactId && c.locationId);
    } catch {
      companies = [];
    }
  }

  return { quote, lineItems, customers, hasPro, hasPaid, companies, shopName, pdfMarca };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const id = `gid://shopify/DraftOrder/${params.id}`;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  // Algunas acciones son de pago (Plan Básico o Pro). Verificamos el plan en el
  // servidor para que el candado no se pueda saltar desde el cliente.
  const requierePago = async () => {
    const c = await billing.check({ plans: TODOS_LOS_PLANES as any, isTest: BILLING_TEST });
    return c.hasActivePayment;
  };

  if (intent === "assignCustomer") {
    const customerId = String(formData.get("customerId") ?? "");
    if (!customerId) return { error: "Selecciona un cliente." };
    const response = await admin.graphql(
      `#graphql
        mutation assignCustomer($id: ID!, $input: DraftOrderInput!) {
          draftOrderUpdate(id: $id, input: $input) {
            draftOrder { id }
            userErrors { field message }
          }
        }`,
      { variables: { id, input: { purchasingEntity: { customerId } } } },
    );
    const json: any = await response.json();
    const errs = json.data?.draftOrderUpdate?.userErrors ?? [];
    if (errs.length > 0) return { error: errs.map((e: any) => e.message).join(", ") };
    return { ok: true, assigned: true };
  }

  if (intent === "assignCompany") {
    const companyId = String(formData.get("companyId") ?? "");
    const companyContactId = String(formData.get("companyContactId") ?? "");
    const companyLocationId = String(formData.get("companyLocationId") ?? "");
    if (!companyId || !companyContactId || !companyLocationId) {
      return { error: "Selecciona una empresa." };
    }
    const response = await admin.graphql(
      `#graphql
        mutation assignCompany($id: ID!, $input: DraftOrderInput!) {
          draftOrderUpdate(id: $id, input: $input) {
            draftOrder { id }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          id,
          input: {
            purchasingEntity: {
              purchasingCompany: {
                companyId,
                companyContactId,
                companyLocationId,
              },
            },
          },
        },
      },
    );
    const json: any = await response.json();
    const errs = json.data?.draftOrderUpdate?.userErrors ?? [];
    if (errs.length > 0) return { error: errs.map((e: any) => e.message).join(", ") };
    return { ok: true, companyAssigned: true };
  }

  if (intent === "sendInvoice") {
    if (!(await requierePago())) {
      return {
        error:
          "Enviar la cotización por email está disponible desde el Plan Básico.",
      };
    }
    // Enviamos NUESTRO correo (plantilla minimalista editable) con el link de
    // pago, en vez del invoice nativo de Shopify. Como Shopify solo cambia el
    // estado a INVOICE_SENT con su propio envío, marcamos el envío con un
    // customAttribute "Cotización enviada" para reflejarlo en la app.
    const dataResp = await admin.graphql(
      `#graphql
        query datosEnvio($id: ID!) {
          draftOrder(id: $id) {
            name
            invoiceUrl
            customer { displayName email }
            customAttributes { key value }
            totalPriceSet { shopMoney { amount currencyCode } }
          }
          shop {
            name
            metafield(namespace: "$app:flouvia", key: "config") { value }
          }
        }`,
      { variables: { id } },
    );
    const dataJson: any = await dataResp.json();
    const dq = dataJson.data?.draftOrder;
    const shop = dataJson.data?.shop;
    if (!dq) return { error: "No se encontró la cotización." };

    const attr = (k: string) =>
      (dq.customAttributes ?? []).find((a: any) => a.key === k)?.value ?? "";
    const requesterEmail = attr("Email solicitante") || dq.customer?.email || "";
    const requesterName = attr("Solicitante") || dq.customer?.displayName || "";

    if (!requesterEmail) {
      return {
        error:
          "Esta cotización no tiene un correo de cliente. Asigna un cliente o pide su correo.",
      };
    }
    if (!dq.invoiceUrl) {
      return { error: "La cotización todavía no tiene link de pago." };
    }

    // Plantillas editables del comerciante.
    let cfg: any = {};
    try {
      const raw = shop?.metafield?.value;
      if (raw) cfg = JSON.parse(raw);
    } catch {
      cfg = {};
    }
    const templates = mergeEmails(cfg.emails);

    const money = dq.totalPriceSet?.shopMoney;
    const total = money
      ? formatoMoneda(money.amount, money.currencyCode)
      : "";

    const res = await notifyRequesterQuoteSent({
      requesterEmail,
      requesterName,
      quoteName: dq.name,
      shopName: shop?.name,
      invoiceUrl: dq.invoiceUrl,
      total,
      templates,
    });

    if (!res.ok) {
      return {
        error:
          res.error ||
          "No se pudo enviar el correo. Revisa la configuración de Resend.",
      };
    }

    // Dejamos constancia del envío (fecha legible para la app).
    const fecha = new Date().toLocaleDateString("es-MX", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const customAttributes = await mergeCustomAttributes(admin, id, {
      "Cotización enviada": fecha,
    });
    await admin.graphql(
      `#graphql
        mutation marcarEnviada($id: ID!, $input: DraftOrderInput!) {
          draftOrderUpdate(id: $id, input: $input) {
            draftOrder { id }
            userErrors { field message }
          }
        }`,
      { variables: { id, input: { customAttributes } } },
    );

    return { ok: true, sent: true };
  }

  if (intent === "saveTerms") {
    if (!(await requierePago())) {
      return {
        error:
          "Los términos de crédito están disponibles desde el Plan Básico.",
      };
    }
    const creditTerms = String(formData.get("creditTerms") ?? "");
    const customAttributes = await mergeCustomAttributes(admin, id, {
      "Términos de crédito": creditTerms,
    });
    const response = await admin.graphql(
      `#graphql
        mutation saveTerms($id: ID!, $input: DraftOrderInput!) {
          draftOrderUpdate(id: $id, input: $input) {
            draftOrder { id }
            userErrors { field message }
          }
        }`,
      { variables: { id, input: { customAttributes } } },
    );
    const json: any = await response.json();
    const errs = json.data?.draftOrderUpdate?.userErrors ?? [];
    if (errs.length > 0) return { error: errs.map((e: any) => e.message).join(", ") };
    return { ok: true, termsSaved: true };
  }

  if (intent === "saveFiscal") {
    const customAttributes = await mergeCustomAttributes(admin, id, {
      RFC: String(formData.get("rfc") ?? ""),
      "Razón social": String(formData.get("razonSocial") ?? ""),
      "Régimen fiscal": String(formData.get("regimen") ?? ""),
      "Uso de CFDI": String(formData.get("usoCfdi") ?? ""),
      "Código postal fiscal": String(formData.get("cp") ?? ""),
    });
    const response = await admin.graphql(
      `#graphql
        mutation saveFiscal($id: ID!, $input: DraftOrderInput!) {
          draftOrderUpdate(id: $id, input: $input) {
            draftOrder { id }
            userErrors { field message }
          }
        }`,
      { variables: { id, input: { customAttributes } } },
    );
    const json: any = await response.json();
    const errs = json.data?.draftOrderUpdate?.userErrors ?? [];
    if (errs.length > 0) return { error: errs.map((e: any) => e.message).join(", ") };
    return { ok: true, fiscalSaved: true };
  }

  if (intent === "generarCFDI") {
    const r = await admin.graphql(
      `#graphql
        query cfdiData($id: ID!) {
          draftOrder(id: $id) {
            customAttributes { key value }
            lineItems(first: 50) {
              edges {
                node {
                  title
                  quantity
                  originalUnitPriceSet { shopMoney { amount } }
                }
              }
            }
          }
        }`,
      { variables: { id } },
    );
    const j: any = await r.json();
    const attrs = j.data?.draftOrder?.customAttributes ?? [];
    const get = (k: string) => attrs.find((a: any) => a.key === k)?.value ?? "";

    const rfc = get("RFC");
    if (!rfc) {
      return {
        error: "Falta el RFC del cliente. Guárdalo en Datos fiscales primero.",
      };
    }

    const items = (j.data?.draftOrder?.lineItems?.edges ?? []).map((e: any) => ({
      description: e.node.title,
      quantity: e.node.quantity,
      unitPrice: parseFloat(
        e.node.originalUnitPriceSet.shopMoney.amount || "0",
      ),
    }));

    const result = await timbrarCFDI(session.shop, {
      receiver: {
        rfc,
        name: get("Razón social"),
        cfdiUse: get("Uso de CFDI"),
        fiscalRegime: get("Régimen fiscal"),
        taxZipCode: get("Código postal fiscal"),
      },
      items,
    });

    if (!result.ok) return { error: `CFDI: ${result.error}` };

    const customAttributes = await mergeCustomAttributes(admin, id, {
      "CFDI UUID": result.uuid ?? "",
    });
    await admin.graphql(
      `#graphql
        mutation saveUuid($id: ID!, $input: DraftOrderInput!) {
          draftOrderUpdate(id: $id, input: $input) {
            draftOrder { id }
            userErrors { field message }
          }
        }`,
      { variables: { id, input: { customAttributes } } },
    );

    // Cuenta el timbrado del mes y cobra el excedente si pasó de la cuota
    // (Pro 250 / Plus 1000). No bloquea: la factura ya se timbró.
    const uso = await registrarTimbrado(
      session.shop,
      billing as any,
      admin as any,
      BILLING_TEST,
    );

    return { ok: true, cfdiGenerated: true, uuid: result.uuid, uso };
  }

  if (intent === "completarPedido") {
    // Convierte la cotización (Draft Order) en un PEDIDO real de Shopify.
    // paymentPending: true → crea el pedido con el pago PENDIENTE (no lo marca
    // como pagado). Es lo correcto para B2B a crédito (Net 30/60) o pago por
    // transferencia: el pedido ya existe y se puede surtir; el comerciante marca
    // el pago cuando entre. La cotización pasa a estado COMPLETED.
    const response = await admin.graphql(
      `#graphql
        mutation completarPedido($id: ID!) {
          draftOrderComplete(id: $id, paymentPending: true) {
            draftOrder {
              id
              status
            }
            userErrors { field message }
          }
        }`,
      { variables: { id } },
    );
    const json: any = await response.json();
    const errs = json.data?.draftOrderComplete?.userErrors ?? [];
    if (errs.length > 0) return { error: errs.map((e: any) => e.message).join(", ") };
    return { ok: true, completed: true };
  }

  // --- Guardar productos, cantidades, precios y descuento ---
  const payload = JSON.parse(String(formData.get("payload") ?? "{}"));
  const items = payload.items ?? [];
  const discountPct = Number(payload.discountPct) || 0;

  const lineItems = items
    .filter((it: any) => it.variantId)
    .map((it: any) => ({
      variantId: it.variantId,
      quantity: Number(it.quantity) || 1,
      priceOverride: { amount: String(it.price), currencyCode: it.currencyCode },
    }));

  if (lineItems.length === 0) {
    return { error: "La cotización debe tener al menos un producto." };
  }

  const input: any = { lineItems };
  input.appliedDiscount =
    discountPct > 0
      ? { value: discountPct, valueType: "PERCENTAGE", title: "Descuento" }
      : null;

  const response = await admin.graphql(
    `#graphql
      mutation updateQuote($id: ID!, $input: DraftOrderInput!) {
        draftOrderUpdate(id: $id, input: $input) {
          draftOrder { id }
          userErrors { field message }
        }
      }`,
    { variables: { id, input } },
  );
  const json: any = await response.json();
  const errs = json.data?.draftOrderUpdate?.userErrors ?? [];
  if (errs.length > 0) return { error: errs.map((e: any) => e.message).join(", ") };
  return { ok: true };
};

export default function QuoteDetail() {
  const { quote, lineItems, customers, hasPro, hasPaid, companies, shopName, pdfMarca } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const moneda = quote.totalPriceSet.shopMoney.currencyCode;

  const getAttr = (key: string) =>
    (quote.customAttributes ?? []).find((a: any) => a.key === key)?.value ?? "";

  const [rfc, setRfc] = useState(getAttr("RFC"));
  const [razonSocial, setRazonSocial] = useState(getAttr("Razón social"));
  const [regimen, setRegimen] = useState(getAttr("Régimen fiscal"));
  const [usoCfdi, setUsoCfdi] = useState(getAttr("Uso de CFDI"));
  const [cp, setCp] = useState(getAttr("Código postal fiscal"));

  const [items, setItems] = useState<any[]>(() =>
    lineItems.map((it: any) => ({
      variantId: it.variant?.id ?? null,
      title: it.title,
      quantity: it.quantity,
      price: it.originalUnitPriceSet.shopMoney.amount,
      currencyCode: it.originalUnitPriceSet.shopMoney.currencyCode,
    })),
  );

  const [discountPct, setDiscountPct] = useState<string>(
    quote.appliedDiscount?.valueType === "PERCENTAGE"
      ? String(quote.appliedDiscount.value)
      : "0",
  );

  const [selectedCustomer, setSelectedCustomer] = useState<string>(
    quote.customer?.id ?? "",
  );
  const [selectedCompany, setSelectedCompany] = useState<string>("");

  const terminosActuales =
    (quote.customAttributes ?? []).find(
      (a: any) => a.key === "Términos de crédito",
    )?.value ?? "Contado";
  const [creditTerms, setCreditTerms] = useState<string>(terminosActuales);

  const submittingIntent = fetcher.formData?.get("intent");
  const isAssigning =
    fetcher.state !== "idle" && submittingIntent === "assignCustomer";
  const isAssigningCompany =
    fetcher.state !== "idle" && submittingIntent === "assignCompany";
  const isSending =
    fetcher.state !== "idle" && submittingIntent === "sendInvoice";
  const isSavingTerms =
    fetcher.state !== "idle" && submittingIntent === "saveTerms";
  const isSavingItems =
    fetcher.state !== "idle" && submittingIntent === "saveItems";
  const isSavingFiscal =
    fetcher.state !== "idle" && submittingIntent === "saveFiscal";
  const isGenerating =
    fetcher.state !== "idle" && submittingIntent === "generarCFDI";
  const isCompleting =
    fetcher.state !== "idle" && submittingIntent === "completarPedido";

  const yaEsPedido = quote.status === "COMPLETED";

  useEffect(() => {
    if (fetcher.data?.ok) {
      const msg = fetcher.data.sent
        ? "Cotización enviada al cliente"
        : fetcher.data.assigned
          ? "Cliente asignado"
          : fetcher.data.companyAssigned
            ? "Empresa asignada"
            : fetcher.data.termsSaved
              ? "Términos actualizados"
              : fetcher.data.fiscalSaved
                ? "Datos fiscales guardados"
                : fetcher.data.cfdiGenerated
                  ? mensajeCFDI(fetcher.data.uso)
                  : fetcher.data.completed
                    ? "Cotización convertida en pedido"
                    : "Cambios guardados";
      shopify.toast.show(msg);
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const setQty = (i: number, val: string) =>
    setItems((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], quantity: Number(val) || 1 };
      return next;
    });

  const setPrice = (i: number, val: string) =>
    setItems((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], price: val };
      return next;
    });

  const quitarItem = (i: number) =>
    setItems((prev) => prev.filter((_, idx) => idx !== i));

  const agregarProductos = async () => {
    const selection = await shopify.resourcePicker({
      type: "product",
      multiple: true,
    });
    if (!selection) return;
    const nuevos = selection
      .map((p: any) => {
        const v = p.variants?.[0];
        if (!v) return null;
        return {
          variantId: v.id,
          title: p.title,
          quantity: 1,
          price: v.price ?? "0",
          currencyCode: moneda,
        };
      })
      .filter(Boolean);
    setItems((prev) => [...prev, ...nuevos]);
  };

  const guardarCambios = () =>
    fetcher.submit(
      { intent: "saveItems", payload: JSON.stringify({ items, discountPct }) },
      { method: "POST" },
    );

  const asignarCliente = () =>
    fetcher.submit(
      { intent: "assignCustomer", customerId: selectedCustomer },
      { method: "POST" },
    );

  const enviarAlCliente = () =>
    fetcher.submit({ intent: "sendInvoice" }, { method: "POST" });

  const asignarEmpresa = () => {
    const empresa = companies.find((c: any) => c.id === selectedCompany);
    if (!empresa) return;
    fetcher.submit(
      {
        intent: "assignCompany",
        companyId: empresa.id,
        companyContactId: empresa.contactId,
        companyLocationId: empresa.locationId,
      },
      { method: "POST" },
    );
  };

  const guardarTerminos = () =>
    fetcher.submit({ intent: "saveTerms", creditTerms }, { method: "POST" });

  const guardarFiscal = () =>
    fetcher.submit(
      { intent: "saveFiscal", rfc, razonSocial, regimen, usoCfdi, cp },
      { method: "POST" },
    );

  const generarCFDI = () =>
    fetcher.submit({ intent: "generarCFDI" }, { method: "POST" });

  const convertirEnPedido = () => {
    const ok = window.confirm(
      "¿Convertir esta cotización en un pedido?\n\nSe creará un pedido real en Shopify con el pago PENDIENTE " +
        "(podrás marcarlo como pagado cuando entre el dinero). Guarda primero cualquier cambio de precio.",
    );
    if (!ok) return;
    fetcher.submit({ intent: "completarPedido" }, { method: "POST" });
  };

  // Genera el PDF de la cotización con los datos en pantalla. Usa un iframe
  // oculto + el diálogo de impresión del navegador ("Guardar como PDF").
  const descargarPDF = () => {
    const html = construirHTMLcotizacion({
      folio: quote.name,
      shopName,
      fecha: new Date().toLocaleDateString("es-MX", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      clienteNombre:
        quote.customer?.displayName || getAttr("Solicitante") || "",
      clienteEmail:
        quote.customer?.email || getAttr("Email solicitante") || "",
      items,
      moneda,
      discountPct: Number(discountPct) || 0,
      terminos: creditTerms,
      rfc,
      razonSocial,
      // Solo aplica la marca personalizada si tiene plan de pago. En Gratis
      // el PDF sale con el diseño por defecto (azul fijo, sin logo ni datos).
      marca: hasPaid ? pdfMarca : undefined,
    });
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);
    const win = iframe.contentWindow;
    if (!win) {
      document.body.removeChild(iframe);
      shopify.toast.show("No se pudo generar el PDF", { isError: true });
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    // Pequeña espera para que el navegador pinte el contenido antes de imprimir.
    setTimeout(() => {
      win.focus();
      win.print();
      setTimeout(() => document.body.removeChild(iframe), 1000);
    }, 300);
  };

  const copiarLink = async () => {
    try {
      await navigator.clipboard.writeText(quote.invoiceUrl);
      shopify.toast.show("Link de pago copiado");
    } catch {
      shopify.toast.show("No se pudo copiar; usa 'Abrir link de pago'", {
        isError: true,
      });
    }
  };

  const requesterAttrs = (quote.customAttributes ?? []).filter((a: any) =>
    ["Solicitante", "Email solicitante", "Origen"].includes(a.key),
  );

  return (
    <s-page heading={`Cotización ${quote.name}`}>
      <s-button
        slot="breadcrumbs"
        variant="tertiary"
        href="/app/quotes"
        icon="arrow-left"
      >
        Cotizaciones
      </s-button>

      <style>{CSS}</style>
      <div className="qd-wrap">
        {/* Cliente */}
        <div className="qd-card">
          <div className="qd-head">
            <h2>Cliente</h2>
            <span className={`qd-status ${estadoClase(quote.status)}`}>
              {estadoLegible(quote.status)}
            </span>
          </div>
          <p className="qd-muted">
            {quote.customer?.displayName ?? "Sin cliente asignado"}
            {quote.customer?.email ? ` · ${quote.customer.email}` : ""}
          </p>
          {requesterAttrs.map((a: any) => (
            <p className="qd-muted" key={a.key}>
              {a.key}: {a.value}
            </p>
          ))}

          {customers.length === 0 ? (
            <p className="qd-muted">
              No hay clientes en la tienda. Crea uno en el admin para asignarlo.
            </p>
          ) : (
            <>
              <label className="qd-label">Asignar cliente</label>
              <select
                className="qd-select"
                value={selectedCustomer}
                onChange={(e) => setSelectedCustomer(e.target.value)}
              >
                <option value="">— Elegir cliente —</option>
                {customers.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
              <button
                className="qd-btn ghost"
                onClick={asignarCliente}
                disabled={isAssigning}
              >
                {isAssigning ? "Asignando…" : "Asignar cliente"}
              </button>
            </>
          )}

          {hasPro ? (
            companies.length === 0 ? (
              <p className="qd-muted" style={{ marginTop: 16 }}>
                Empresas B2B: no hay empresas en la tienda (o B2B no está
                activado). Crea una en Clientes → Empresas.
              </p>
            ) : (
              <>
                <label className="qd-label">Asignar empresa B2B</label>
                <select
                  className="qd-select"
                  value={selectedCompany}
                  onChange={(e) => setSelectedCompany(e.target.value)}
                >
                  <option value="">— Elegir empresa —</option>
                  {companies.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  className="qd-btn ghost"
                  onClick={asignarEmpresa}
                  disabled={isAssigningCompany}
                >
                  {isAssigningCompany ? "Asignando…" : "Asignar empresa"}
                </button>
              </>
            )
          ) : (
            <div style={{ marginTop: 16 }}>
              <label className="qd-label" style={{ marginTop: 0 }}>
                🔒 Asignar empresa B2B · Plan Pro
              </label>
              <p className="qd-muted">
                Vincula la cotización a una empresa con límite de crédito en el
                Plan Pro.{" "}
                <a
                  href="/app/plans"
                  style={{ color: "#1a56c4", fontWeight: 600 }}
                >
                  Ver planes
                </a>
              </p>
            </div>
          )}
        </div>

        {/* Términos de crédito — desde Plan Básico */}
        {hasPaid ? (
          <div className="qd-card">
            <h2>Términos de crédito</h2>
            <select
              className="qd-select"
              value={creditTerms}
              onChange={(e) => setCreditTerms(e.target.value)}
            >
              <option value="Contado">Contado (pago inmediato)</option>
              <option value="Net 30">Net 30 (30 días)</option>
              <option value="Net 60">Net 60 (60 días)</option>
            </select>
            <button
              className="qd-btn ghost"
              onClick={guardarTerminos}
              disabled={isSavingTerms}
            >
              {isSavingTerms ? "Guardando…" : "Guardar términos"}
            </button>
          </div>
        ) : (
          <div className="qd-card qd-lock">
            <h2>Términos de crédito · Plan Básico</h2>
            <p className="qd-muted">
              Ofrece condiciones de pago (Net 30 / Net 60) a tus clientes B2B
              desde el Plan Básico.
            </p>
            <button
              className="qd-btn primary"
              onClick={() => navigate("/app/plans")}
            >
              Ver planes
            </button>
          </div>
        )}

        {/* Datos fiscales (CFDI) */}
        {hasPro ? (
          <div className="qd-card">
            <h2>Datos fiscales (CFDI)</h2>
            <p className="qd-muted">
              Datos del comprador para la factura CFDI (se usan al timbrar).
            </p>
            <div className="qd-grid2">
              <div>
                <label className="qd-label">RFC</label>
                <input
                  className="qd-input"
                  value={rfc}
                  onChange={(e) => setRfc(e.target.value)}
                />
              </div>
              <div>
                <label className="qd-label">Razón social</label>
                <input
                  className="qd-input"
                  value={razonSocial}
                  onChange={(e) => setRazonSocial(e.target.value)}
                />
              </div>
              <div>
                <label className="qd-label">Régimen fiscal</label>
                <select
                  className="qd-select"
                  value={regimen}
                  onChange={(e) => setRegimen(e.target.value)}
                >
                  <option value="">— Elegir —</option>
                  <option value="601">601 - General de Ley Personas Morales</option>
                  <option value="603">603 - Personas Morales Fines no Lucrativos</option>
                  <option value="605">605 - Sueldos y Salarios</option>
                  <option value="612">612 - Personas Físicas Actividad Empresarial</option>
                  <option value="616">616 - Sin obligaciones fiscales</option>
                  <option value="626">626 - Régimen Simplificado de Confianza</option>
                </select>
              </div>
              <div>
                <label className="qd-label">Uso de CFDI</label>
                <select
                  className="qd-select"
                  value={usoCfdi}
                  onChange={(e) => setUsoCfdi(e.target.value)}
                >
                  <option value="">— Elegir —</option>
                  <option value="G01">G01 - Adquisición de mercancías</option>
                  <option value="G03">G03 - Gastos en general</option>
                  <option value="I08">I08 - Otra maquinaria y equipo</option>
                  <option value="S01">S01 - Sin efectos fiscales</option>
                  <option value="P01">P01 - Por definir</option>
                </select>
              </div>
              <div>
                <label className="qd-label">Código postal fiscal</label>
                <input
                  className="qd-input"
                  value={cp}
                  onChange={(e) => setCp(e.target.value)}
                />
              </div>
            </div>
            <button
              className="qd-btn ghost"
              onClick={guardarFiscal}
              disabled={isSavingFiscal}
            >
              {isSavingFiscal ? "Guardando…" : "Guardar datos fiscales"}
            </button>
            {getAttr("CFDI UUID") ? (
              <div className="qd-success">
                ✅ Factura CFDI generada · Folio fiscal (UUID):{" "}
                {getAttr("CFDI UUID")}
              </div>
            ) : (
              <button
                className="qd-btn primary"
                onClick={generarCFDI}
                disabled={isGenerating}
                style={{ marginLeft: 10 }}
              >
                {isGenerating ? "Timbrando…" : "Generar factura CFDI"}
              </button>
            )}
          </div>
        ) : (
          <div className="qd-card qd-lock">
            <h2>Datos fiscales (CFDI) · Plan Pro</h2>
            <p className="qd-muted">
              La facturación CFDI (datos fiscales y timbrado automático) está
              disponible en el Plan Pro.
            </p>
            <button
              className="qd-btn primary"
              onClick={() => navigate("/app/plans")}
            >
              Ver planes
            </button>
          </div>
        )}

        {/* Productos y precios */}
        <div className="qd-card">
          <h2>Productos y precios negociados</h2>
          {items.map((item: any, i: number) => (
            <div className="qd-item" key={i}>
              <div className="it-title">{item.title}</div>
              <div className="qd-fields">
                <div>
                  <label className="qd-label" style={{ marginTop: 0 }}>
                    Cantidad
                  </label>
                  <input
                    className="qd-input"
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) => setQty(i, e.target.value)}
                  />
                </div>
                {item.variantId ? (
                  <div>
                    <label className="qd-label" style={{ marginTop: 0 }}>
                      Precio unitario ({moneda})
                    </label>
                    <input
                      className="qd-input"
                      type="number"
                      step="0.01"
                      value={item.price}
                      onChange={(e) => setPrice(i, e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="qd-muted">
                    Precio: {item.price} {moneda} (sin variante)
                  </div>
                )}
              </div>
              <button className="qd-rm" onClick={() => quitarItem(i)}>
                Quitar
              </button>
            </div>
          ))}

          <button className="qd-btn ghost" onClick={agregarProductos}>
            + Agregar productos
          </button>

          <label className="qd-label">Descuento (%)</label>
          <input
            className="qd-input"
            type="number"
            min={0}
            max={100}
            value={discountPct}
            onChange={(e) => setDiscountPct(e.target.value)}
            style={{ maxWidth: 180 }}
          />

          <p className="qd-muted" style={{ marginTop: 14 }}>
            Total actual (guardado):{" "}
            {formatoMoneda(quote.totalPriceSet.shopMoney.amount, moneda)} {moneda}
          </p>
          <div className="qd-actions">
            <button
              className="qd-btn primary"
              onClick={guardarCambios}
              disabled={isSavingItems}
            >
              {isSavingItems ? "Guardando…" : "Guardar cambios"}
            </button>
            <button className="qd-btn secondary" onClick={descargarPDF}>
              📄 Descargar PDF
            </button>
          </div>
          <p className="qd-muted" style={{ marginTop: 8 }}>
            El PDF usa lo que ves en pantalla. Guarda los cambios antes para que
            el total coincida con lo guardado.
          </p>
        </div>

        {/* Convertir en pedido — todos los planes */}
        <div className="qd-card">
          <h2>Convertir en pedido</h2>
          {yaEsPedido ? (
            <div className="qd-success">
              ✅ Esta cotización ya se convirtió en pedido. Búscalo en Shopify →
              Pedidos para surtirlo o marcar el pago.
            </div>
          ) : (
            <>
              <p className="qd-muted">
                Cuando el cliente acepte, conviértela en un pedido real de
                Shopify con un clic. Se crea con el <b>pago pendiente</b>: ideal
                para crédito (Net 30/60) o transferencia. Marcas el pago en
                Shopify cuando entre el dinero.
              </p>
              <button
                className="qd-btn primary"
                onClick={convertirEnPedido}
                disabled={isCompleting}
              >
                {isCompleting ? "Convirtiendo…" : "Convertir en pedido"}
              </button>
            </>
          )}
        </div>

        {/* Link de pago */}
        <div className="qd-card">
          <h2>Link de pago para el cliente</h2>
          {quote.invoiceUrl ? (
            <>
              <p className="qd-muted">
                Comparte este link con el comprador para que pague la
                cotización:
              </p>
              <div className="qd-actions">
                <a
                  className="qd-btn primary"
                  href={quote.invoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir link de pago
                </a>
                <button className="qd-btn secondary" onClick={copiarLink}>
                  Copiar link de pago
                </button>
              </div>
              {quote.customer?.email ? (
                hasPaid ? (
                  <>
                    <button
                      className="qd-btn ghost"
                      onClick={enviarAlCliente}
                      disabled={isSending}
                    >
                      {isSending
                        ? "Enviando…"
                        : getAttr("Cotización enviada")
                          ? "Reenviar al cliente por email"
                          : "Enviar al cliente por email"}
                    </button>
                    {getAttr("Cotización enviada") ? (
                      <p
                        className="qd-muted"
                        style={{
                          marginTop: 8,
                          color: "#15803d",
                          fontWeight: 600,
                        }}
                      >
                        ✓ Enviada al cliente el {getAttr("Cotización enviada")}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="qd-muted" style={{ marginTop: 12 }}>
                    🔒 Enviar la cotización por email está disponible desde el{" "}
                    <b>Plan Básico</b>. Mientras tanto puedes copiar el link de
                    arriba y mandarlo tú.{" "}
                    <a
                      href="/app/plans"
                      style={{ color: "#1a56c4", fontWeight: 600 }}
                    >
                      Ver planes
                    </a>
                  </p>
                )
              ) : (
                <p className="qd-muted">
                  Asigna un cliente con correo para enviar la cotización por
                  email.
                </p>
              )}
            </>
          ) : (
            <p className="qd-muted">
              Esta cotización todavía no tiene link de pago.
            </p>
          )}
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
