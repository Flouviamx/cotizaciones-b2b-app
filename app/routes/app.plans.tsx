import { Fragment, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  PLAN_BASICO_MENSUAL,
  PLAN_BASICO_ANUAL,
  PLAN_PRO_MENSUAL,
  PLAN_PRO_ANUAL,
  PLAN_PLUS_MENSUAL,
  PLAN_PLUS_ANUAL,
  PRECIO_BASICO_MENSUAL,
  PRECIO_BASICO_ANUAL,
  PRECIO_PRO_MENSUAL,
  PRECIO_PRO_ANUAL,
  PRECIO_PLUS_MENSUAL,
  PRECIO_PLUS_ANUAL,
  TODOS_LOS_PLANES,
  LIMITE_FREE,
  CFDI_LIMITE_PRO,
  CFDI_LIMITE_PLUS,
  CFDI_EXTRA_PRO,
  CFDI_EXTRA_PLUS,
} from "../plans";
import { BILLING_TEST } from "../billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing } = await authenticate.admin(request);
  const check = await billing.check({
    plans: TODOS_LOS_PLANES as any,
    isTest: BILLING_TEST,
  });
  const activos = (check.appSubscriptions ?? []).map((s: any) => s.name);

  // ¿Es una tienda Shopify Plus? El Plan Plus solo se ofrece a tiendas Plus.
  let esShopifyPlus = false;
  try {
    const r = await admin.graphql(
      `#graphql
        query { shop { plan { shopifyPlus } } }`,
    );
    const j: any = await r.json();
    esShopifyPlus = Boolean(j.data?.shop?.plan?.shopifyPlus);
  } catch {
    esShopifyPlus = false;
  }

  return { activos, esShopifyPlus };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();

  // Bajar al Plan Gratis = cancelar la suscripción de pago activa.
  // Requisito 1.2.2/1.2.3 de la App Store: el comerciante debe poder
  // cancelar o bajar de plan desde la app, sin soporte ni reinstalar.
  if (String(formData.get("intent")) === "cancelar") {
    try {
      const check = await billing.check({
        plans: TODOS_LOS_PLANES as any,
        isTest: BILLING_TEST,
      });
      for (const sub of check.appSubscriptions ?? []) {
        await billing.cancel({
          subscriptionId: sub.id,
          isTest: BILLING_TEST,
          prorate: true,
        });
      }
      return { cancelado: true };
    } catch (e: any) {
      if (e instanceof Response) throw e;
      console.error("BILLING CANCEL ERROR:", e?.name, e?.message, e);
      return {
        error: `No se pudo cancelar la suscripción. ${e?.message ?? ""}`,
      };
    }
  }

  const plan = String(formData.get("plan"));
  try {
    return await billing.request({ plan: plan as any, isTest: BILLING_TEST });
  } catch (e: any) {
    // Si es un redirect (Response), NO es un error: es Shopify mandándote a la
    // pantalla de aprobación de cobro. Hay que dejarlo pasar.
    if (e instanceof Response) throw e;

    // Extraemos el máximo detalle posible del error real para diagnosticar.
    let detalle = "";
    if (e?.errorData) detalle = JSON.stringify(e.errorData);
    else if (e?.message) detalle = e.message;
    else if (e?.body) detalle = JSON.stringify(e.body);
    else {
      try {
        detalle = JSON.stringify(e, Object.getOwnPropertyNames(e));
      } catch {
        detalle = String(e);
      }
    }
    console.error("BILLING ERROR detallado:", e?.name, e?.message, e);
    return {
      error: `[${e?.name ?? "Error"}] plan="${plan}" · ${detalle || "(sin detalle)"}`,
    };
  }
};

const BENEFICIOS = [
  { icon: "✉️", titulo: "Soporte por email" },
  { icon: "🤝", titulo: "Solución B2B inteligente" },
  { icon: "📚", titulo: "Documentación de ayuda" },
  { icon: "🎨", titulo: "Estilo personalizable" },
];

const FEATURES_FREE = [
  `Hasta ${LIMITE_FREE} cotizaciones activas`,
  'Botón "Solicitar cotización" en la tienda',
  "Precios negociados y descuentos",
  "Aviso por correo de nuevas solicitudes",
  "Convertir cotización en pedido (pago en checkout de Shopify)",
  "PDF descargable (diseño por defecto)",
];

const FEATURES_BASICO = [
  "Cotizaciones ilimitadas",
  'Sin la marca "Flouvia" en la ventana',
  "Confirmación automática al comprador",
  "Enviar cotización por email con link de pago",
  "Plantillas de correo editables",
  "Términos de crédito (Net 30 / Net 60)",
  "PDF con tu logo y marca",
];

const FEATURES_PRO = [
  "Todo lo del Plan Básico",
  "Empresas B2B con crédito por empresa",
  "Campos B2B en el formulario (tel, empresa, RFC)",
  "Formulario de cotización personalizable",
  "Analítica avanzada",
  `CFDI automático — ${CFDI_LIMITE_PRO} facturas/mes incluidas`,
  `Factura extra: $${CFDI_EXTRA_PRO.toFixed(2)} USD c/u`,
];

const FEATURES_PLUS = [
  "Todo lo del Plan Pro",
  `CFDI automático — ${CFDI_LIMITE_PLUS} facturas/mes incluidas`,
  `Factura extra a mitad de precio: $${CFDI_EXTRA_PLUS.toFixed(2)} USD c/u`,
  "Soporte prioritario para alto volumen",
  "Exclusivo para tiendas Shopify Plus",
];

// Comparación detallada de planes. Cada valor puede ser:
//  - true  → incluido (✓ verde)
//  - false → no incluido (— gris)
//  - string → texto descriptivo (ej. "Hasta 5")
// `plus` es opcional: si no se indica, hereda el valor de `pro` (Plus incluye
// todo lo de Pro). Solo se especifica en las filas donde Plus difiere (CFDI).
const COMPARATIVA: {
  grupo: string;
  filas: {
    f: string;
    nota?: string;
    free: boolean | string;
    basico: boolean | string;
    pro: boolean | string;
    plus?: boolean | string;
  }[];
}[] = [
  {
    grupo: "Cotizaciones",
    filas: [
      {
        f: "Cotizaciones activas",
        nota: "Las cotizaciones pagadas liberan cupo",
        free: `Hasta ${LIMITE_FREE}`,
        basico: "Ilimitadas",
        pro: "Ilimitadas",
      },
      {
        f: 'Botón "Solicitar cotización" en la tienda',
        free: true,
        basico: true,
        pro: true,
      },
      {
        f: "Modal de cotización (productos · contacto · revisar)",
        free: true,
        basico: true,
        pro: true,
      },
      {
        f: "Precios negociados y descuentos por cotización",
        free: true,
        basico: true,
        pro: true,
      },
      {
        f: "Clientes creados automáticamente",
        free: true,
        basico: true,
        pro: true,
      },
      {
        f: 'Modo "solo cotización" (ocultar precio y carrito)',
        free: true,
        basico: true,
        pro: true,
      },
      {
        f: "Convertir cotización en pedido + link de pago",
        free: true,
        basico: true,
        pro: true,
      },
    ],
  },
  {
    grupo: "Correos automáticos",
    filas: [
      {
        f: "Aviso al vendedor de nuevas solicitudes",
        free: true,
        basico: true,
        pro: true,
      },
      {
        f: "Confirmación de cotización al cliente",
        free: false,
        basico: true,
        pro: true,
      },
      {
        f: "Enviar cotización por email (link de pago)",
        free: false,
        basico: true,
        pro: true,
      },
      {
        f: "Plantillas de correo 100% editables",
        nota: "Asunto, encabezado y mensaje con variables",
        free: false,
        basico: true,
        pro: true,
      },
    ],
  },
  {
    grupo: "Marca y personalización",
    filas: [
      {
        f: "Estilo y color del botón personalizables",
        free: true,
        basico: true,
        pro: true,
      },
      {
        f: "PDF descargable de la cotización",
        free: "Por defecto",
        basico: "Con tu marca",
        pro: "Con tu marca",
      },
      {
        f: 'Sin la marca "Flouvia" en la ventana',
        free: false,
        basico: true,
        pro: true,
      },
      {
        f: "Logo, color y datos de empresa en el PDF",
        free: false,
        basico: true,
        pro: true,
      },
      {
        f: "Formulario de cotización personalizable",
        nota: "Edita textos y colores del modal sin tocar el tema",
        free: false,
        basico: false,
        pro: true,
      },
    ],
  },
  {
    grupo: "Crédito y B2B",
    filas: [
      {
        f: "Términos de crédito (Net 30 / Net 60)",
        free: false,
        basico: true,
        pro: true,
      },
      {
        f: "Campos B2B en el modal (teléfono, empresa, RFC)",
        free: false,
        basico: false,
        pro: true,
      },
      {
        f: "Empresas B2B con límite de crédito por empresa",
        nota: "Tablero de empresas con barra de uso de crédito",
        free: false,
        basico: false,
        pro: true,
      },
    ],
  },
  {
    grupo: "Facturación CFDI y analítica",
    filas: [
      {
        f: "CFDI — facturación electrónica automática",
        nota: "Se timbra al cerrar la cotización (vía PAC)",
        free: false,
        basico: false,
        pro: true,
        plus: true,
      },
      {
        f: "Facturas CFDI incluidas por mes",
        free: false,
        basico: false,
        pro: `${CFDI_LIMITE_PRO}`,
        plus: `${CFDI_LIMITE_PLUS}`,
      },
      {
        f: "Costo por factura adicional",
        nota: "Se cobra como excedente solo si pasas la cuota mensual",
        free: false,
        basico: false,
        pro: `$${CFDI_EXTRA_PRO.toFixed(2)} USD`,
        plus: `$${CFDI_EXTRA_PLUS.toFixed(2)} USD`,
      },
      {
        f: "Analítica (ingresos, conversión, embudo, top clientes)",
        free: false,
        basico: false,
        pro: true,
      },
    ],
  },
  {
    grupo: "Soporte",
    filas: [
      { f: "Soporte por email", free: true, basico: true, pro: true },
      { f: "Documentación de ayuda", free: true, basico: true, pro: true },
      {
        f: "Soporte prioritario alto volumen",
        free: false,
        basico: false,
        pro: false,
        plus: true,
      },
    ],
  },
];

const FAQS = [
  {
    q: "¿Necesito Shopify Plus?",
    a: `No para usar la app: Gratis, Básico y Pro funcionan en cualquier plan de Shopify. El Plan Plus sí es exclusivo para tiendas Shopify Plus (sube la cuota de CFDI a ${CFDI_LIMITE_PLUS} facturas/mes y abarata el excedente).`,
  },
  {
    q: "¿El CFDI es automático?",
    a: `Sí, desde el Plan Pro. Conectas tu cuenta de un PAC y la factura se timbra al cerrar la cotización. Pro incluye ${CFDI_LIMITE_PRO} facturas/mes y Plus ${CFDI_LIMITE_PLUS}/mes.`,
  },
  {
    q: "¿Qué pasa si me paso de las facturas incluidas?",
    a: `No se bloquea: cada factura adicional se cobra como excedente ($${CFDI_EXTRA_PRO.toFixed(2)} USD en Pro, $${CFDI_EXTRA_PLUS.toFixed(2)} en Plus) y aparece en tu próximo cobro de Shopify. La cuota se reinicia cada mes. Te avisamos al acercarte al límite.`,
  },
  {
    q: "¿Puedo cambiar de plan cuando quiera?",
    a: "Sí, desde esta misma página. El cambio se aplica de inmediato y se prorratea automáticamente.",
  },
  {
    q: "¿Hay prueba gratis?",
    a: "Sí, 7 días gratis en cualquier plan. No se te cobra hasta terminar la prueba.",
  },
  {
    q: "¿En qué países funciona?",
    a: "Optimizada para México (MXN, CFDI y crédito), pero el flujo de cotizaciones funciona en cualquier tienda Shopify.",
  },
];

const CSS = `
.fp-wrap { max-width: 1180px; margin: 0 auto; padding: 8px 16px 40px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; color: #1a1a2e; }
.fp-hero { text-align: center; padding: 16px 0 8px; }
.fp-hero h1 { font-size: 30px; font-weight: 750; margin: 0 0 8px; letter-spacing: -0.02em; }
.fp-hero p { color: #6b7280; font-size: 15px; margin: 0 0 20px; }

.fp-toggle { display: inline-flex; background: #f1f1f4; border-radius: 999px; padding: 4px; gap: 4px; }
.fp-toggle button { border: 0; background: transparent; padding: 9px 18px; border-radius: 999px;
  font-size: 14px; font-weight: 600; color: #6b7280; cursor: pointer; transition: all .18s ease; }
.fp-toggle button.on { background: #fff; color: #1a56c4; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.fp-save { margin-left: 6px; background: #dcfce7; color: #15803d; border-radius: 999px;
  padding: 2px 8px; font-size: 11px; font-weight: 700; }

.fp-benefits { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 28px 0; }
.fp-benefit { background: #fff; border: 1px solid #ececf0; border-radius: 14px; padding: 16px;
  text-align: center; }
.fp-benefit .ic { width: 42px; height: 42px; border-radius: 12px; margin: 0 auto 10px;
  display: flex; align-items: center; justify-content: center; font-size: 20px;
  background: linear-gradient(135deg, #e8f0fe, #eaf1fd); }
.fp-benefit span { font-size: 13px; font-weight: 600; color: #374151; }

.fp-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 18px; align-items: stretch; }
.fp-card { position: relative; display: flex; flex-direction: column; box-sizing: border-box;
  background: #fff; border: 1.5px solid #e7e7ee; border-radius: 20px; padding: 24px 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,.05); transition: transform .2s ease, box-shadow .2s ease; }
.fp-card:hover { transform: translateY(-3px); box-shadow: 0 14px 30px -12px rgba(0,0,0,.18); }
.fp-card.pro { border-color: #1a73e8; box-shadow: 0 14px 34px -10px rgba(26,115,232,.35); }
.fp-card.pro:hover { box-shadow: 0 20px 40px -12px rgba(26,115,232,.45); }
.fp-card.plus { border-color: #5b3df5; background: linear-gradient(180deg, #fbfaff, #fff);
  box-shadow: 0 14px 34px -10px rgba(91,61,245,.32); }
.fp-card.plus:hover { box-shadow: 0 20px 40px -12px rgba(91,61,245,.45); }
.fp-ribbon { position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
  background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff; font-size: 11.5px; font-weight: 800;
  letter-spacing: .03em; text-transform: uppercase; padding: 5px 14px; border-radius: 999px;
  box-shadow: 0 4px 12px rgba(26,115,232,.4); white-space: nowrap; }
.fp-ribbon.plus { background: linear-gradient(135deg, #5b3df5, #8b5cf6); box-shadow: 0 4px 12px rgba(91,61,245,.4); }
.fp-name { font-size: 20px; font-weight: 800; margin: 0; letter-spacing: -0.01em; }
.fp-tagline { font-size: 13px; color: #6b7280; font-weight: 500; margin: 3px 0 16px; }
.fp-price { display: flex; align-items: baseline; gap: 6px; margin: 0 0 2px; }
.fp-amount { font-size: 42px; font-weight: 800; letter-spacing: -0.03em; }
.fp-period { color: #6b7280; font-size: 14px; font-weight: 500; }
.fp-equiv { color: #16a34a; font-size: 13px; font-weight: 600; margin-bottom: 18px; min-height: 18px; }
/* El form que envuelve el botón no debe romper la alineación de la fila CTA */
.fp-card form { margin: 0; padding: 0; width: 100%; display: block; }
.fp-cta { display: block; width: 100%; box-sizing: border-box; text-align: center; border: 0; border-radius: 12px;
  padding: 13px; min-height: 48px; font-size: 15px; font-weight: 700; cursor: pointer; transition: opacity .15s ease; }
.fp-cta:hover { opacity: .9; }
.fp-cta.basic { background: #1a1a2e; color: #fff; }
.fp-cta.downgrade { background: #fff; color: #374151; border: 1.5px solid #d1d5db; }
.fp-cta.downgrade:hover { border-color: #9ca3af; opacity: 1; }
.fp-cta.cancelar { background: #dc2626; color: #fff; }
.fp-downgrade-back { display: block; width: 100%; margin-top: 8px; background: transparent;
  border: 0; color: #6b7280; font-size: 13px; font-weight: 600; cursor: pointer; padding: 6px; }
.fp-downgrade-back:hover { color: #374151; }
.fp-downgrade-nota { font-size: 12px; color: #9ca3af; line-height: 1.45; margin: 8px 0 0; }
.fp-cta.pro { background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff; }
.fp-cta.plus { background: linear-gradient(135deg, #5b3df5, #8b5cf6); color: #fff; }
.fp-locked { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; box-sizing: border-box;
  text-align: center; border-radius: 12px; padding: 13px; min-height: 48px;
  font-size: 13.5px; font-weight: 700; background: #f3f0ff; color: #6d5bd0; border: 1px dashed #c7bdf5; }
.fp-current { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; box-sizing: border-box;
  text-align: center; border-radius: 12px; padding: 13px; min-height: 48px;
  font-size: 15px; font-weight: 700; background: #dcfce7; color: #15803d; }
.fp-free-tag { display: flex; align-items: center; justify-content: center; width: 100%; box-sizing: border-box;
  text-align: center; border-radius: 12px; padding: 13px; min-height: 48px;
  font-size: 14px; font-weight: 700; background: #f1f1f4; color: #6b7280; }
.fp-feats { list-style: none; padding: 0; margin: 22px 0 0; display: grid; gap: 12px; }
.fp-feats li { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; color: #374151; }
.fp-feats .chk { flex: 0 0 20px; width: 20px; height: 20px; border-radius: 999px; background: #dcfce7;
  color: #16a34a; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; margin-top: 1px; }
.fp-feats .label-row { font-weight: 700; color: #1a56c4; }

/* Comparativa desplegable */
.fp-cmp { margin-top: 34px; }
.fp-cmp-toggle { width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px;
  background: #fff; border: 1.5px solid #e7e7ee; border-radius: 14px; padding: 15px 20px;
  font-size: 15px; font-weight: 700; color: #1a56c4; cursor: pointer; transition: all .18s ease; }
.fp-cmp-toggle:hover { border-color: #1a73e8; background: #f7faff; }
.fp-cmp-chev { transition: transform .2s ease; font-size: 18px; }
.fp-cmp-chev.open { transform: rotate(180deg); }
.fp-cmp-table-wrap { margin-top: 14px; border: 1px solid #ececf0; border-radius: 16px; overflow: hidden;
  overflow-x: auto; box-shadow: 0 1px 3px rgba(0,0,0,.05); animation: fp-cmp-in .22s ease; }
@keyframes fp-cmp-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
.fp-cmp-table { width: 100%; border-collapse: collapse; background: #fff; min-width: 560px; }
.fp-cmp-table th { padding: 14px 16px; font-size: 14px; font-weight: 800; text-align: center;
  color: #1a1a2e; background: #fafafc; border-bottom: 1px solid #ececf0; }
.fp-cmp-table th.fp-cmp-feat-h { text-align: left; }
.fp-cmp-table th.fp-cmp-pro-h { color: #1a56c4; }
.fp-cmp-table th.fp-cmp-plus-h { color: #5b3df5; }
.fp-cmp-table td { padding: 13px 16px; font-size: 13.5px; text-align: center; color: #374151;
  border-bottom: 1px solid #f1f1f4; }
.fp-cmp-table tr:last-child td { border-bottom: 0; }
.fp-cmp-feat { text-align: left !important; font-weight: 600; color: #1a1a2e; }
.fp-cmp-feat .fp-cmp-nota { display: block; font-size: 12px; font-weight: 400; color: #9ca3af; margin-top: 2px; }
.fp-cmp-group td { background: #f7faff; font-size: 12px; font-weight: 800; text-transform: uppercase;
  letter-spacing: .04em; color: #1a56c4; text-align: left; padding: 10px 16px; }
.fp-cmp-pro-col { background: #f7faff; }
.fp-cmp-plus-col { background: #faf8ff; }
.fp-cmp-yes { color: #16a34a; font-weight: 800; font-size: 16px; }
.fp-cmp-no { color: #cbd0d8; font-weight: 700; }
.fp-cmp-val { font-weight: 700; color: #1a1a2e; }

.fp-faq { margin-top: 40px; }
.fp-faq h2 { font-size: 22px; font-weight: 750; margin: 0 0 16px; }
.fp-q { background: #fff; border: 1px solid #ececf0; border-radius: 14px; margin-bottom: 10px; overflow: hidden; }
.fp-q button { width: 100%; text-align: left; background: transparent; border: 0; padding: 16px 18px;
  font-size: 15px; font-weight: 600; color: #1a1a2e; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.fp-q .chev { transition: transform .2s ease; color: #9ca3af; flex: 0 0 auto; }
.fp-q.open .chev { transform: rotate(180deg); }
.fp-q .ans { padding: 0 18px 16px; color: #6b7280; font-size: 14px; line-height: 1.55; }

@media (max-width: 1040px) {
  .fp-cards { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 720px) {
  .fp-benefits { grid-template-columns: repeat(2, 1fr); }
  .fp-cards { grid-template-columns: 1fr; }
  .fp-hero h1 { font-size: 24px; }
}
`;

function celdaComparativa(valor: boolean | string) {
  if (valor === true) return <span className="fp-cmp-yes">✓</span>;
  if (valor === false) return <span className="fp-cmp-no">—</span>;
  return <span className="fp-cmp-val">{valor}</span>;
}

export default function Plans() {
  const { activos, esShopifyPlus } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as
    | { error?: string; cancelado?: boolean }
    | undefined;

  const [intervalo, setIntervalo] = useState<"mensual" | "anual">("mensual");
  const [faqAbierta, setFaqAbierta] = useState<number | null>(0);
  const [tablaAbierta, setTablaAbierta] = useState(false);
  const [confirmandoGratis, setConfirmandoGratis] = useState(false);

  const esAnual = intervalo === "anual";
  // Sin ningún plan de pago activo = la tienda está en el Plan Gratis.
  const esFree = activos.length === 0;
  const planBasico = esAnual ? PLAN_BASICO_ANUAL : PLAN_BASICO_MENSUAL;
  const planPro = esAnual ? PLAN_PRO_ANUAL : PLAN_PRO_MENSUAL;
  const planPlus = esAnual ? PLAN_PLUS_ANUAL : PLAN_PLUS_MENSUAL;
  const precioBasico = esAnual ? PRECIO_BASICO_ANUAL : PRECIO_BASICO_MENSUAL;
  const precioPro = esAnual ? PRECIO_PRO_ANUAL : PRECIO_PRO_MENSUAL;
  const precioPlus = esAnual ? PRECIO_PLUS_ANUAL : PRECIO_PLUS_MENSUAL;
  const periodo = esAnual ? "USD / año" : "USD / mes";

  return (
    <s-page heading="Planes">
      {actionData?.error ? (
        <s-banner tone="critical" heading="No se pudo procesar el plan">
          {actionData.error}
        </s-banner>
      ) : null}
      {actionData?.cancelado ? (
        <s-banner tone="success" heading="Plan cancelado">
          Listo: tu suscripción se canceló y ahora estás en el Plan Gratis.
          Puedes volver a un plan de pago cuando quieras desde esta página.
        </s-banner>
      ) : null}

      <style>{CSS}</style>

      <div className="fp-wrap">
        <div className="fp-hero">
          <h1>Elige el plan ideal para tu negocio B2B</h1>
          <p>Prueba gratis de 7 días · cambia o cancela cuando quieras</p>
          <div className="fp-toggle">
            <button
              className={!esAnual ? "on" : ""}
              onClick={() => setIntervalo("mensual")}
            >
              Mensual
            </button>
            <button
              className={esAnual ? "on" : ""}
              onClick={() => setIntervalo("anual")}
            >
              Anual <span className="fp-save">ahorra 17%</span>
            </button>
          </div>
        </div>

        {/* Beneficios */}
        <div className="fp-benefits">
          {BENEFICIOS.map((b) => (
            <div className="fp-benefit" key={b.titulo}>
              <div className="ic">{b.icon}</div>
              <span>{b.titulo}</span>
            </div>
          ))}
        </div>

        {/* Cards de planes */}
        <div className="fp-cards">
          {/* Gratis */}
          <div className="fp-card">
            <div className="fp-name">Gratis</div>
            <div className="fp-tagline">Para empezar sin costo</div>
            <div className="fp-price">
              <span className="fp-amount">$0</span>
              <span className="fp-period">para siempre</span>
            </div>
            <div className="fp-equiv">&nbsp;</div>
            {esFree ? (
              <div className="fp-current">Tu plan actual</div>
            ) : confirmandoGratis ? (
              <div>
                <Form method="post">
                  <input type="hidden" name="intent" value="cancelar" />
                  <button type="submit" className="fp-cta cancelar">
                    Sí, cancelar mi suscripción
                  </button>
                </Form>
                <button
                  className="fp-downgrade-back"
                  onClick={() => setConfirmandoGratis(false)}
                >
                  No, conservar mi plan
                </button>
                <p className="fp-downgrade-nota">
                  Se cancela tu plan de pago y pasas al Plan Gratis (tope de{" "}
                  {LIMITE_FREE} cotizaciones activas). Tus cotizaciones no se
                  borran.
                </p>
              </div>
            ) : (
              <button
                className="fp-cta downgrade"
                onClick={() => setConfirmandoGratis(true)}
              >
                Cambiar al plan Gratis
              </button>
            )}
            <ul className="fp-feats">
              {FEATURES_FREE.map((f) => (
                <li key={f}>
                  <span className="chk">✓</span> {f}
                </li>
              ))}
            </ul>
          </div>

          {/* Básico */}
          <div className="fp-card">
            <div className="fp-name">Básico</div>
            <div className="fp-tagline">Para vender en serio</div>
            <div className="fp-price">
              <span className="fp-amount">${precioBasico}</span>
              <span className="fp-period">{periodo}</span>
            </div>
            <div className="fp-equiv">
              {esAnual
                ? `Equivale a $${(PRECIO_BASICO_ANUAL / 12).toFixed(2)}/mes`
                : " "}
            </div>
            {activos.includes(planBasico) ? (
              <div className="fp-current">Tu plan actual</div>
            ) : (
              <Form method="post">
                <input type="hidden" name="plan" value={planBasico} />
                <button type="submit" className="fp-cta basic">
                  Elegir Básico
                </button>
              </Form>
            )}
            <ul className="fp-feats">
              {FEATURES_BASICO.map((f) => (
                <li key={f}>
                  <span className="chk">✓</span> {f}
                </li>
              ))}
            </ul>
          </div>

          {/* Pro */}
          <div className="fp-card pro">
            <div className="fp-ribbon">Más popular</div>
            <div className="fp-name">Pro</div>
            <div className="fp-tagline">Para escalar tu B2B</div>
            <div className="fp-price">
              <span className="fp-amount">${precioPro}</span>
              <span className="fp-period">{periodo}</span>
            </div>
            <div className="fp-equiv">
              {esAnual
                ? `Equivale a $${(PRECIO_PRO_ANUAL / 12).toFixed(2)}/mes`
                : " "}
            </div>
            {activos.includes(planPro) ? (
              <div className="fp-current">Tu plan actual</div>
            ) : (
              <Form method="post">
                <input type="hidden" name="plan" value={planPro} />
                <button type="submit" className="fp-cta pro">
                  Elegir Pro
                </button>
              </Form>
            )}
            <ul className="fp-feats">
              {FEATURES_PRO.map((f, i) => (
                <li key={f}>
                  <span className="chk">✓</span>{" "}
                  <span className={i === 0 ? "label-row" : ""}>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Plus — solo Shopify Plus */}
          <div className="fp-card plus">
            <div className="fp-ribbon plus">Shopify Plus</div>
            <div className="fp-name">Plus</div>
            <div className="fp-tagline">Para alto volumen B2B</div>
            <div className="fp-price">
              <span className="fp-amount">${precioPlus}</span>
              <span className="fp-period">{periodo}</span>
            </div>
            <div className="fp-equiv">
              {esAnual
                ? `Equivale a $${(PRECIO_PLUS_ANUAL / 12).toFixed(2)}/mes`
                : " "}
            </div>
            {activos.includes(planPlus) ? (
              <div className="fp-current">Tu plan actual</div>
            ) : esShopifyPlus ? (
              <Form method="post">
                <input type="hidden" name="plan" value={planPlus} />
                <button type="submit" className="fp-cta plus">
                  Elegir Plus
                </button>
              </Form>
            ) : (
              <div className="fp-locked" title="Disponible solo para tiendas Shopify Plus">
                🔒 Solo Shopify Plus
              </div>
            )}
            <ul className="fp-feats">
              {FEATURES_PLUS.map((f, i) => (
                <li key={f}>
                  <span className="chk">✓</span>{" "}
                  <span className={i === 0 ? "label-row" : ""}>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Comparativa detallada (desplegable) */}
        <div className="fp-cmp">
          <button
            className="fp-cmp-toggle"
            onClick={() => setTablaAbierta((v) => !v)}
            aria-expanded={tablaAbierta}
          >
            <span>
              {tablaAbierta ? "Ocultar" : "Ver"} comparación detallada de los
              planes
            </span>
            <span className={`fp-cmp-chev ${tablaAbierta ? "open" : ""}`}>⌄</span>
          </button>

          {tablaAbierta ? (
            <div className="fp-cmp-table-wrap">
              <table className="fp-cmp-table">
                <thead>
                  <tr>
                    <th className="fp-cmp-feat-h">Funcionalidad</th>
                    <th>Gratis</th>
                    <th>Básico</th>
                    <th className="fp-cmp-pro-h">Pro</th>
                    <th className="fp-cmp-plus-h">Plus</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARATIVA.map((g) => (
                    <Fragment key={g.grupo}>
                      <tr className="fp-cmp-group">
                        <td colSpan={5}>{g.grupo}</td>
                      </tr>
                      {g.filas.map((fila) => (
                        <tr key={fila.f}>
                          <td className="fp-cmp-feat">
                            {fila.f}
                            {fila.nota ? (
                              <span className="fp-cmp-nota">{fila.nota}</span>
                            ) : null}
                          </td>
                          <td>{celdaComparativa(fila.free)}</td>
                          <td>{celdaComparativa(fila.basico)}</td>
                          <td className="fp-cmp-pro-col">
                            {celdaComparativa(fila.pro)}
                          </td>
                          <td className="fp-cmp-plus-col">
                            {celdaComparativa(fila.plus ?? fila.pro)}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {/* FAQ */}
        <div className="fp-faq">
          <h2>Preguntas frecuentes</h2>
          {FAQS.map((f, i) => (
            <div className={`fp-q ${faqAbierta === i ? "open" : ""}`} key={i}>
              <button
                onClick={() => setFaqAbierta(faqAbierta === i ? null : i)}
              >
                <span>{f.q}</span>
                <span className="chev">⌄</span>
              </button>
              {faqAbierta === i ? <div className="ans">{f.a}</div> : null}
            </div>
          ))}
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
