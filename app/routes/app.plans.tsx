import { Fragment, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useActionData, useLoaderData, useSubmit } from "react-router";
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

function celdaComparativa(valor: boolean | string) {
  if (valor === true) return <s-text tone="success">✓</s-text>;
  if (valor === false) return <s-text color="subdued">—</s-text>;
  return <s-text>{valor}</s-text>;
}

// Fila de una feature: palomita + texto. Compartida por la card compacta y la
// hero.
function Feature({ f }: { f: string }) {
  return (
    <s-stack direction="inline" gap="small-300" alignItems="start">
      <s-icon type="check" tone="success" />
      <s-text>{f}</s-text>
    </s-stack>
  );
}

// Precio grande: única licencia tipográfica de la página (los precios son el
// dato que el comerciante compara de un vistazo). Hereda tipografía/color del
// admin, solo cambia el tamaño.
function PrecioGrande({ texto, size = "1.9rem" }: { texto: string; size?: string }) {
  return (
    <span
      style={{
        fontSize: size,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {texto}
    </span>
  );
}

// Tarjeta compacta de un plan (Gratis, Básico, Plus) — misma altura, en fila.
function CardPlan(props: {
  nombre: string;
  tagline: string;
  precioTexto: string;
  periodo: string;
  equivalencia?: string;
  badge?: string;
  cta: React.ReactNode;
  features: string[];
}) {
  return (
    <s-box border="base" borderRadius="base" padding="large-100">
      <s-stack gap="base">
        <s-stack gap="small-300">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-heading>{props.nombre}</s-heading>
            {props.badge ? <s-badge tone="info">{props.badge}</s-badge> : null}
          </s-stack>
          <s-text color="subdued">{props.tagline}</s-text>
        </s-stack>

        <s-stack gap="small-300">
          <s-stack direction="inline" gap="small-300" alignItems="baseline">
            <PrecioGrande texto={props.precioTexto} />
            <s-text color="subdued">{props.periodo}</s-text>
          </s-stack>
          {props.equivalencia ? (
            <s-text tone="success">{props.equivalencia}</s-text>
          ) : (
            <s-text color="subdued">&nbsp;</s-text>
          )}
        </s-stack>

        {props.cta}

        <s-divider />

        <s-stack gap="small-300">
          {props.features.map((f) => (
            <Feature f={f} key={f} />
          ))}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

// Tarjeta hero: el plan recomendado, a todo lo ancho, con features en dos
// columnas (igual que las páginas de precios de otras apps del App Store).
function CardPlanHero(props: {
  nombre: string;
  tagline: string;
  precioTexto: string;
  periodo: string;
  equivalencia?: string;
  cta: React.ReactNode;
  features: string[];
}) {
  const mitad = Math.ceil(props.features.length / 2);
  const col1 = props.features.slice(0, mitad);
  const col2 = props.features.slice(mitad);
  return (
    <s-box
      border="base strong"
      borderRadius="base"
      padding="large-200"
      background="subdued"
    >
      <s-grid gridTemplateColumns="1fr 1.4fr" gap="large-100">
        <s-stack gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-heading>{props.nombre}</s-heading>
            <s-badge tone="success">Recomendado</s-badge>
          </s-stack>
          <s-text color="subdued">{props.tagline}</s-text>
          <s-stack gap="small-300">
            <s-stack direction="inline" gap="small-300" alignItems="baseline">
              <PrecioGrande texto={props.precioTexto} size="2.6rem" />
              <s-text color="subdued">{props.periodo}</s-text>
            </s-stack>
            {props.equivalencia ? (
              <s-text tone="success">{props.equivalencia}</s-text>
            ) : (
              <s-text color="subdued">Prueba gratis de 7 días</s-text>
            )}
          </s-stack>
          {props.cta}
        </s-stack>

        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
          gap="small-300"
        >
          <s-stack gap="small-300">
            {col1.map((f) => (
              <Feature f={f} key={f} />
            ))}
          </s-stack>
          <s-stack gap="small-300">
            {col2.map((f) => (
              <Feature f={f} key={f} />
            ))}
          </s-stack>
        </s-grid>
      </s-grid>
    </s-box>
  );
}

export default function Plans() {
  const { activos, esShopifyPlus } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as
    | { error?: string; cancelado?: boolean }
    | undefined;
  const submit = useSubmit();

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

  const elegirPlan = (plan: string) => submit({ plan }, { method: "post" });
  const cancelarPlan = () =>
    submit({ intent: "cancelar" }, { method: "post" });

  const badgeActual = (
    <s-stack direction="inline">
      <s-badge tone="success">Tu plan actual</s-badge>
    </s-stack>
  );

  const planActivoNombre = activos[0] ?? "Gratis";

  return (
    <s-page heading="Planes">
      <s-badge slot="accessory" tone={esFree ? "info" : "success"}>
        {`Plan actual: ${planActivoNombre}`}
      </s-badge>
      {actionData?.error ? (
        <s-banner tone="critical" heading="No se pudo procesar el plan">
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-banner>
      ) : null}
      {actionData?.cancelado ? (
        <s-banner tone="success" heading="Plan cancelado">
          <s-paragraph>
            Listo: tu suscripción se canceló y ahora estás en el Plan Gratis.
            Puedes volver a un plan de pago cuando quieras desde esta página.
          </s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading="Elige el plan ideal para tu negocio B2B">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            Prueba gratis de 7 días · cambia o cancela cuando quieras. Con el
            plan anual ahorras 17% (10 meses por el precio de 12).
          </s-paragraph>
          <s-stack direction="inline" gap="small-200">
            <s-button
              variant={!esAnual ? "primary" : "secondary"}
              onClick={() => setIntervalo("mensual")}
            >
              Mensual
            </s-button>
            <s-button
              variant={esAnual ? "primary" : "secondary"}
              onClick={() => setIntervalo("anual")}
            >
              Anual · ahorra 17%
            </s-button>
          </s-stack>

          {/* Pro: el plan recomendado va destacado y a todo lo ancho arriba,
              como en las páginas de precios más convincentes del App Store. */}
          <CardPlanHero
            nombre="Pro"
            tagline="Para escalar tu B2B"
            precioTexto={`$${precioPro}`}
            periodo={periodo}
            equivalencia={
              esAnual
                ? `Equivale a $${(PRECIO_PRO_ANUAL / 12).toFixed(2)}/mes`
                : undefined
            }
            features={FEATURES_PRO}
            cta={
              activos.includes(planPro) ? (
                badgeActual
              ) : (
                <s-button variant="primary" onClick={() => elegirPlan(planPro)}>
                  Iniciar prueba gratuita
                </s-button>
              )
            }
          />

          {/* Los otros 3 planes, en fila, con el mismo peso visual entre sí. */}
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(230px, 1fr))"
            gap="base"
          >
            {/* Gratis */}
            <CardPlan
              nombre="Gratis"
              tagline="Para empezar sin costo"
              precioTexto="$0"
              periodo="para siempre"
              features={FEATURES_FREE}
              cta={
                esFree ? (
                  badgeActual
                ) : confirmandoGratis ? (
                  <s-stack gap="small-200">
                    <s-button tone="critical" variant="primary" onClick={cancelarPlan}>
                      Sí, cancelar mi suscripción
                    </s-button>
                    <s-button
                      variant="tertiary"
                      onClick={() => setConfirmandoGratis(false)}
                    >
                      No, conservar mi plan
                    </s-button>
                    <s-text color="subdued">
                      Se cancela tu plan de pago y pasas al Plan Gratis (tope
                      de {LIMITE_FREE} cotizaciones activas). Tus cotizaciones
                      no se borran.
                    </s-text>
                  </s-stack>
                ) : (
                  <s-button onClick={() => setConfirmandoGratis(true)}>
                    Cambiar al plan Gratis
                  </s-button>
                )
              }
            />

            {/* Básico */}
            <CardPlan
              nombre="Básico"
              tagline="Para vender en serio"
              precioTexto={`$${precioBasico}`}
              periodo={periodo}
              equivalencia={
                esAnual
                  ? `Equivale a $${(PRECIO_BASICO_ANUAL / 12).toFixed(2)}/mes`
                  : undefined
              }
              features={FEATURES_BASICO}
              cta={
                activos.includes(planBasico) ? (
                  badgeActual
                ) : (
                  <s-button onClick={() => elegirPlan(planBasico)}>
                    Elegir Básico
                  </s-button>
                )
              }
            />

            {/* Plus — solo Shopify Plus */}
            <CardPlan
              nombre="Plus"
              tagline="Para alto volumen B2B"
              precioTexto={`$${precioPlus}`}
              periodo={periodo}
              badge="Shopify Plus"
              equivalencia={
                esAnual
                  ? `Equivale a $${(PRECIO_PLUS_ANUAL / 12).toFixed(2)}/mes`
                  : undefined
              }
              features={FEATURES_PLUS}
              cta={
                activos.includes(planPlus) ? (
                  badgeActual
                ) : esShopifyPlus ? (
                  <s-button variant="primary" onClick={() => elegirPlan(planPlus)}>
                    Elegir Plus
                  </s-button>
                ) : (
                  <s-badge tone="neutral" icon="lock">
                    Solo Shopify Plus
                  </s-badge>
                )
              }
            />
          </s-grid>
        </s-stack>
      </s-section>

      {/* Comparativa detallada (desplegable) */}
      <s-section heading="Comparación detallada">
        <s-stack gap="base">
          <s-stack direction="inline">
            <s-button onClick={() => setTablaAbierta((v) => !v)}>
              {tablaAbierta ? "Ocultar comparación" : "Ver comparación de planes"}
            </s-button>
          </s-stack>

          {tablaAbierta ? (
            <s-table>
              <s-table-header-row>
                <s-table-header>Funcionalidad</s-table-header>
                <s-table-header>Gratis</s-table-header>
                <s-table-header>Básico</s-table-header>
                <s-table-header>Pro</s-table-header>
                <s-table-header>Plus</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {COMPARATIVA.map((g) => (
                  <Fragment key={g.grupo}>
                    <s-table-row>
                      <s-table-cell>
                        <s-badge tone="info">{g.grupo}</s-badge>
                      </s-table-cell>
                      <s-table-cell>{""}</s-table-cell>
                      <s-table-cell>{""}</s-table-cell>
                      <s-table-cell>{""}</s-table-cell>
                      <s-table-cell>{""}</s-table-cell>
                    </s-table-row>
                    {g.filas.map((fila) => (
                      <s-table-row key={fila.f}>
                        <s-table-cell>
                          <s-stack gap="small-300">
                            <s-text>{fila.f}</s-text>
                            {fila.nota ? (
                              <s-text color="subdued">{fila.nota}</s-text>
                            ) : null}
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>{celdaComparativa(fila.free)}</s-table-cell>
                        <s-table-cell>
                          {celdaComparativa(fila.basico)}
                        </s-table-cell>
                        <s-table-cell>{celdaComparativa(fila.pro)}</s-table-cell>
                        <s-table-cell>
                          {celdaComparativa(fila.plus ?? fila.pro)}
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </Fragment>
                ))}
              </s-table-body>
            </s-table>
          ) : null}
        </s-stack>
      </s-section>

      {/* FAQ */}
      <s-section heading="Preguntas frecuentes">
        <s-stack gap="base">
          {FAQS.map((f, i) => (
            <s-stack gap="small-300" key={f.q}>
              {i > 0 ? <s-divider /> : null}
              <s-clickable
                onClick={() => setFaqAbierta(faqAbierta === i ? null : i)}
              >
                <s-stack
                  direction="inline"
                  justifyContent="space-between"
                  alignItems="center"
                  gap="small-200"
                >
                  <s-text>{f.q}</s-text>
                  <s-icon type={faqAbierta === i ? "chevron-up" : "chevron-down"} />
                </s-stack>
              </s-clickable>
              {faqAbierta === i ? (
                <s-paragraph color="subdued">{f.a}</s-paragraph>
              ) : null}
            </s-stack>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
