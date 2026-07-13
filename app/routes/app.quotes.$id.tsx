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

// Tono del badge de Polaris según el estado de la cotización.
function estadoTone(status: string): "info" | "caution" | "success" {
  if (status === "INVOICE_SENT") return "caution";
  if (status === "COMPLETED") return "success";
  return "info";
}

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
    // Candado de plan en el SERVIDOR (la UI ya lo bloquea, pero el POST no se
    // debe poder saltar): CFDI es feature Pro/Plus.
    const proCheck = await billing.check({
      plans: PLANES_PRO as any,
      isTest: BILLING_TEST,
    });
    if (!proCheck.hasActivePayment) {
      return { error: "La facturación CFDI está disponible desde el Plan Pro." };
    }
    const r = await admin.graphql(
      `#graphql
        query cfdiData($id: ID!) {
          shop { taxesIncluded }
          draftOrder(id: $id) {
            customAttributes { key value }
            lineItems(first: 50) {
              edges {
                node {
                  title
                  quantity
                  approximateDiscountedUnitPriceSet { shopMoney { amount } }
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
    const saved = (k: string) => attrs.find((a: any) => a.key === k)?.value ?? "";
    // Prefiere lo que viene del formulario (lo que el comerciante ve en pantalla);
    // si un campo no se envió, cae en lo ya guardado en la cotización. Así "Generar"
    // ya no exige darle "Guardar datos fiscales" antes.
    const campo = (name: string, savedKey: string) => {
      const v = formData.get(name);
      return v != null && String(v).trim() !== ""
        ? String(v).trim()
        : saved(savedKey);
    };

    const rfc = campo("rfc", "RFC").toUpperCase();
    const razonSocial = campo("razonSocial", "Razón social");
    const regimen = campo("regimen", "Régimen fiscal");
    const usoCfdi = campo("usoCfdi", "Uso de CFDI");
    const cp = campo("cp", "Código postal fiscal");

    if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) {
      return {
        error: rfc
          ? `El RFC del cliente "${rfc}" no tiene un formato válido (12 o 13 caracteres).`
          : "Falta el RFC del cliente. Captúralo en Datos fiscales.",
      };
    }

    // Precio unitario CON los descuentos aplicados (incluye el descuento % de
    // la cotización): la factura debe cuadrar con lo que el cliente paga en el
    // checkout. Fallback al precio original si el campo viniera vacío.
    const items = (j.data?.draftOrder?.lineItems?.edges ?? []).map((e: any) => ({
      description: e.node.title,
      quantity: e.node.quantity,
      unitPrice: parseFloat(
        e.node.approximateDiscountedUnitPriceSet?.shopMoney?.amount ||
          e.node.originalUnitPriceSet.shopMoney.amount ||
          "0",
      ),
    }));

    const result = await timbrarCFDI(session.shop, {
      receiver: {
        rfc,
        name: razonSocial,
        cfdiUse: usoCfdi,
        fiscalRegime: regimen,
        taxZipCode: cp,
      },
      items,
      // Si los precios de la tienda YA incluyen IVA, la factura debe desglosarlo
      // (no agregar 16% encima). Lo dicta la configuración fiscal de la tienda.
      taxIncluded: Boolean(j.data?.shop?.taxesIncluded),
    });

    if (!result.ok) return { error: `CFDI: ${result.error}` };

    // Guarda el UUID Y los datos fiscales que se usaron (por si venían del form).
    const customAttributes = await mergeCustomAttributes(admin, id, {
      "CFDI UUID": result.uuid ?? "",
      RFC: rfc,
      "Razón social": razonSocial,
      "Régimen fiscal": regimen,
      "Uso de CFDI": usoCfdi,
      "Código postal fiscal": cp,
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
    fetcher.submit(
      { intent: "generarCFDI", rfc, razonSocial, regimen, usoCfdi, cp },
      { method: "POST" },
    );

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

      {/* Cliente */}
      <s-section heading="Cliente">
        <s-stack gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-badge tone={estadoTone(quote.status)}>
              {estadoLegible(quote.status)}
            </s-badge>
            <s-text color="subdued">
              {quote.customer?.displayName ?? "Sin cliente asignado"}
              {quote.customer?.email ? ` · ${quote.customer.email}` : ""}
            </s-text>
          </s-stack>
          {requesterAttrs.length > 0 ? (
            <s-stack gap="small-300">
              {requesterAttrs.map((a: any) => (
                <s-text color="subdued" key={a.key}>
                  {a.key}: {a.value}
                </s-text>
              ))}
            </s-stack>
          ) : null}

          {customers.length === 0 ? (
            <s-paragraph color="subdued">
              No hay clientes en la tienda. Crea uno en el admin para asignarlo.
            </s-paragraph>
          ) : (
            <s-stack direction="inline" gap="small-200" alignItems="end">
              <s-select
                label="Asignar cliente"
                value={selectedCustomer}
                onChange={(e: any) => setSelectedCustomer(e.currentTarget.value)}
              >
                <s-option value="">— Elegir cliente —</s-option>
                {customers.map((c: any) => (
                  <s-option key={c.id} value={c.id}>
                    {c.displayName}
                  </s-option>
                ))}
              </s-select>
              <s-button onClick={asignarCliente} loading={isAssigning}>
                Asignar cliente
              </s-button>
            </s-stack>
          )}

          {hasPro ? (
            companies.length === 0 ? (
              <s-paragraph color="subdued">
                Empresas B2B: no hay empresas en la tienda (o B2B no está
                activado). Crea una en Clientes → Empresas.
              </s-paragraph>
            ) : (
              <s-stack direction="inline" gap="small-200" alignItems="end">
                <s-select
                  label="Asignar empresa B2B"
                  value={selectedCompany}
                  onChange={(e: any) => setSelectedCompany(e.currentTarget.value)}
                >
                  <s-option value="">— Elegir empresa —</s-option>
                  {companies.map((c: any) => (
                    <s-option key={c.id} value={c.id}>
                      {c.name}
                    </s-option>
                  ))}
                </s-select>
                <s-button onClick={asignarEmpresa} loading={isAssigningCompany}>
                  Asignar empresa
                </s-button>
              </s-stack>
            )
          ) : (
            <s-stack gap="small-300">
              <s-stack direction="inline" gap="small-300" alignItems="center">
                <s-badge icon="lock" tone="info">Plan Pro</s-badge>
                <s-text>Asignar empresa B2B</s-text>
              </s-stack>
              <s-paragraph color="subdued">
                Vincula la cotización a una empresa con límite de crédito en el
                Plan Pro.{" "}
                <s-link onClick={() => navigate("/app/plans")}>Ver planes</s-link>
              </s-paragraph>
            </s-stack>
          )}
        </s-stack>
      </s-section>

      {/* Términos de crédito — desde Plan Básico */}
      {hasPaid ? (
        <s-section heading="Términos de crédito">
          <s-stack direction="inline" gap="small-200" alignItems="end">
            <s-select
              label="Forma de pago"
              value={creditTerms}
              onChange={(e: any) => setCreditTerms(e.currentTarget.value)}
            >
              <s-option value="Contado">Contado (pago inmediato)</s-option>
              <s-option value="Net 30">Net 30 (30 días)</s-option>
              <s-option value="Net 60">Net 60 (60 días)</s-option>
            </s-select>
            <s-button onClick={guardarTerminos} loading={isSavingTerms}>
              Guardar términos
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section heading="Términos de crédito">
          <s-stack gap="small-200">
            <s-stack direction="inline">
              <s-badge icon="lock" tone="info">Plan Básico</s-badge>
            </s-stack>
            <s-paragraph color="subdued">
              Ofrece condiciones de pago (Net 30 / Net 60) a tus clientes B2B
              desde el Plan Básico.
            </s-paragraph>
            <s-stack direction="inline">
              <s-button variant="primary" onClick={() => navigate("/app/plans")}>
                Ver planes
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {/* Datos fiscales (CFDI) */}
      {hasPro ? (
        <s-section heading="Datos fiscales (CFDI)">
          <s-stack gap="base">
            <s-paragraph color="subdued">
              Datos del comprador para la factura CFDI (se usan al timbrar).
            </s-paragraph>
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
              gap="base"
            >
              <s-text-field
                label="RFC"
                value={rfc}
                onChange={(e: any) => setRfc(e.currentTarget.value)}
              />
              <s-text-field
                label="Razón social"
                value={razonSocial}
                onChange={(e: any) => setRazonSocial(e.currentTarget.value)}
              />
              <s-select
                label="Régimen fiscal"
                value={regimen}
                onChange={(e: any) => setRegimen(e.currentTarget.value)}
              >
                <s-option value="">— Elegir —</s-option>
                <s-option value="601">601 - General de Ley Personas Morales</s-option>
                <s-option value="603">603 - Personas Morales Fines no Lucrativos</s-option>
                <s-option value="605">605 - Sueldos y Salarios</s-option>
                <s-option value="612">612 - Personas Físicas Actividad Empresarial</s-option>
                <s-option value="616">616 - Sin obligaciones fiscales</s-option>
                <s-option value="626">626 - Régimen Simplificado de Confianza</s-option>
              </s-select>
              <s-select
                label="Uso de CFDI"
                value={usoCfdi}
                onChange={(e: any) => setUsoCfdi(e.currentTarget.value)}
              >
                <s-option value="">— Elegir —</s-option>
                <s-option value="G01">G01 - Adquisición de mercancías</s-option>
                <s-option value="G03">G03 - Gastos en general</s-option>
                <s-option value="I08">I08 - Otra maquinaria y equipo</s-option>
                <s-option value="S01">S01 - Sin efectos fiscales</s-option>
                <s-option value="P01">P01 - Por definir</s-option>
              </s-select>
              <s-text-field
                label="Código postal fiscal"
                value={cp}
                onChange={(e: any) => setCp(e.currentTarget.value)}
              />
            </s-grid>
            <s-stack direction="inline" gap="small-200">
              <s-button onClick={guardarFiscal} loading={isSavingFiscal}>
                Guardar datos fiscales
              </s-button>
              {!getAttr("CFDI UUID") ? (
                <s-button
                  variant="primary"
                  onClick={generarCFDI}
                  loading={isGenerating}
                >
                  Generar factura CFDI
                </s-button>
              ) : null}
            </s-stack>
            {getAttr("CFDI UUID") ? (
              <s-banner tone="success" heading="Factura CFDI generada">
                <s-paragraph>
                  Folio fiscal (UUID): {getAttr("CFDI UUID")}
                </s-paragraph>
              </s-banner>
            ) : null}
          </s-stack>
        </s-section>
      ) : (
        <s-section heading="Datos fiscales (CFDI)">
          <s-stack gap="small-200">
            <s-stack direction="inline">
              <s-badge icon="lock" tone="info">Plan Pro</s-badge>
            </s-stack>
            <s-paragraph color="subdued">
              La facturación CFDI (datos fiscales y timbrado automático) está
              disponible en el Plan Pro.
            </s-paragraph>
            <s-stack direction="inline">
              <s-button variant="primary" onClick={() => navigate("/app/plans")}>
                Ver planes
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {/* Productos y precios */}
      <s-section heading="Productos y precios negociados">
        <s-stack gap="base">
          {items.map((item: any, i: number) => (
            <s-stack gap="small-200" key={i}>
              {i > 0 ? <s-divider /> : null}
              <s-text>{item.title}</s-text>
              <s-stack direction="inline" gap="base" alignItems="end">
                <s-number-field
                  label="Cantidad"
                  min={1}
                  value={`${item.quantity}`}
                  onChange={(e: any) => setQty(i, e.currentTarget.value)}
                />
                {item.variantId ? (
                  <s-number-field
                    label={`Precio unitario (${moneda})`}
                    step={0.01}
                    value={`${item.price}`}
                    onChange={(e: any) => setPrice(i, e.currentTarget.value)}
                  />
                ) : (
                  <s-text color="subdued">
                    Precio: {item.price} {moneda} (sin variante)
                  </s-text>
                )}
                <s-button
                  variant="tertiary"
                  tone="critical"
                  onClick={() => quitarItem(i)}
                >
                  Quitar
                </s-button>
              </s-stack>
            </s-stack>
          ))}

          <s-stack direction="inline" gap="small-200" alignItems="end">
            <s-button icon="plus" onClick={agregarProductos}>
              Agregar productos
            </s-button>
            <s-number-field
              label="Descuento (%)"
              min={0}
              max={100}
              value={discountPct}
              onChange={(e: any) => setDiscountPct(e.currentTarget.value)}
            />
          </s-stack>

          <s-text color="subdued">
            Total actual (guardado):{" "}
            {formatoMoneda(quote.totalPriceSet.shopMoney.amount, moneda)}{" "}
            {moneda}
          </s-text>
          <s-stack direction="inline" gap="small-200">
            <s-button
              variant="primary"
              onClick={guardarCambios}
              loading={isSavingItems}
            >
              Guardar cambios
            </s-button>
            <s-button onClick={descargarPDF}>Descargar PDF</s-button>
          </s-stack>
          <s-text color="subdued">
            El PDF usa lo que ves en pantalla. Guarda los cambios antes para
            que el total coincida con lo guardado.
          </s-text>
        </s-stack>
      </s-section>

      {/* Estado del pedido */}
      <s-section heading="Estado del pedido">
        {yaEsPedido ? (
          <s-banner tone="success" heading="Cotización pagada">
            <s-paragraph>
              El cliente ya pagó esta cotización en el checkout de Shopify.
              Búscala en Shopify → Pedidos para surtirla.
            </s-paragraph>
          </s-banner>
        ) : (
          <s-stack gap="small-200">
            <s-paragraph color="subdued">
              Cuando el cliente acepte, comparte el link de pago de abajo: paga
              de forma segura en el checkout de Shopify y el pedido se crea
              automáticamente.
            </s-paragraph>
            <s-paragraph color="subdued">
              ¿Venta a crédito (Net 30/60) o por transferencia? Completa el
              pedido a mano desde Shopify → Pedidos → Borradores, donde puedes
              marcarlo como pago pendiente.
            </s-paragraph>
          </s-stack>
        )}
      </s-section>

      {/* Link de pago */}
      <s-section heading="Link de pago para el cliente">
        {quote.invoiceUrl ? (
          <s-stack gap="base">
            <s-paragraph color="subdued">
              Comparte este link con el comprador para que pague la cotización:
            </s-paragraph>
            <s-stack direction="inline" gap="small-200">
              <s-button
                variant="primary"
                href={quote.invoiceUrl}
                target="_blank"
                icon="external"
              >
                Abrir link de pago
              </s-button>
              <s-button onClick={copiarLink}>Copiar link de pago</s-button>
            </s-stack>
            {quote.customer?.email ? (
              hasPaid ? (
                <s-stack gap="small-300">
                  <s-stack direction="inline">
                    <s-button onClick={enviarAlCliente} loading={isSending}>
                      {getAttr("Cotización enviada")
                        ? "Reenviar al cliente por email"
                        : "Enviar al cliente por email"}
                    </s-button>
                  </s-stack>
                  {getAttr("Cotización enviada") ? (
                    <s-text tone="success">
                      ✓ Enviada al cliente el {getAttr("Cotización enviada")}
                    </s-text>
                  ) : null}
                </s-stack>
              ) : (
                <s-paragraph color="subdued">
                  🔒 Enviar la cotización por email está disponible desde el
                  Plan Básico. Mientras tanto puedes copiar el link de arriba y
                  mandarlo tú.{" "}
                  <s-link onClick={() => navigate("/app/plans")}>
                    Ver planes
                  </s-link>
                </s-paragraph>
              )
            ) : (
              <s-paragraph color="subdued">
                Asigna un cliente con correo para enviar la cotización por
                email.
              </s-paragraph>
            )}
          </s-stack>
        ) : (
          <s-paragraph color="subdued">
            Esta cotización todavía no tiene link de pago.
          </s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
