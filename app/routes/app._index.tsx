import { useEffect, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  PLANES_PRO,
  PLAN_BASICO_MENSUAL,
  PLAN_BASICO_ANUAL,
  PLAN_PRO_MENSUAL,
  PLAN_PRO_ANUAL,
  PRECIO_BASICO_MENSUAL,
  PRECIO_BASICO_ANUAL,
  PRECIO_PRO_MENSUAL,
  PRECIO_PRO_ANUAL,
  TODOS_LOS_PLANES,
} from "../plans";
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

function estadoLegible(status: string) {
  switch (status) {
    case "OPEN":
      return "Abierta";
    case "INVOICE_SENT":
      return "Enviada";
    case "COMPLETED":
      return "Pagada";
    default:
      return status;
  }
}

// Tono del badge de Polaris según el estado de la cotización.
function estadoTone(status: string): "info" | "caution" | "success" {
  switch (status) {
    case "COMPLETED":
      return "success";
    case "INVOICE_SENT":
      return "caution";
    default:
      return "info";
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);

  const check = await billing.check({
    plans: TODOS_LOS_PLANES as any,
    isTest: BILLING_TEST,
  });
  const activos = (check.appSubscriptions ?? []).map((s: any) => s.name);

  const response = await admin.graphql(
    `#graphql
      query inicioQuotes {
        shop {
          name
          metafield(namespace: "$app:flouvia", key: "config") { value }
        }
        draftOrders(first: 5, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              status
              createdAt
              customer { displayName }
              customAttributes { key value }
              totalPriceSet { shopMoney { amount currencyCode } }
            }
          }
        }
      }`,
  );
  const json: any = await response.json();
  const quotes = (json.data?.draftOrders?.edges ?? []).map((e: any) => e.node);
  const shopName = json.data?.shop?.name ?? "";

  // Autodetección del paso "Activa el botón": ¿llegó alguna solicitud desde la
  // tienda? Las cotizaciones del storefront traen customAttribute Origen.
  const botonActivo = quotes.some((q: any) =>
    (q.customAttributes ?? []).some(
      (a: any) => a.key === "Origen" && /tienda/i.test(a.value ?? ""),
    ),
  );

  // Autodetección del paso CFDI: ¿ya llenó sus datos fiscales (RFC) en Config?
  let fiscalListo = false;
  try {
    const raw = json.data?.shop?.metafield?.value;
    if (raw) {
      const cfg = JSON.parse(raw);
      fiscalListo = !!cfg?.fiscal?.rfc?.trim();
    }
  } catch {
    // config inválida o ausente: tratamos el paso como pendiente
  }

  // Deep link al editor de temas con el panel de "Incrustaciones de la app" ya abierto
  // (?context=apps). Lleva al merchant directo a donde activa el embed de Flouvia, en vez
  // de soltarlo en el editor genérico. Se abre en pestaña nueva, fuera del iframe.
  const themeEditorUrl = `https://${session.shop}/admin/themes/current/editor?context=apps`;

  return { activos, quotes, shopName, botonActivo, fiscalListo, themeEditorUrl };
};

// Datos de presentación de cada plan (para la sección "Tu plan").
function infoPlan(activos: string[]) {
  const nombre = activos[0] ?? null;
  if (!nombre) {
    return {
      nombre: "Gratis",
      precio: null as number | null,
      periodo: "",
      esPro: false,
      features: [
        "Hasta 5 cotizaciones activas",
        'Botón "Solicitar cotización" en la tienda',
        "Precios negociados y descuentos",
        "Link de pago vía checkout de Shopify",
      ],
    };
  }
  const esPro = PLANES_PRO.includes(nombre);
  const esAnual = nombre.includes("Anual");
  let precio = PRECIO_BASICO_MENSUAL;
  if (nombre === PLAN_BASICO_MENSUAL) precio = PRECIO_BASICO_MENSUAL;
  else if (nombre === PLAN_BASICO_ANUAL) precio = PRECIO_BASICO_ANUAL;
  else if (nombre === PLAN_PRO_MENSUAL) precio = PRECIO_PRO_MENSUAL;
  else if (nombre === PLAN_PRO_ANUAL) precio = PRECIO_PRO_ANUAL;

  const features = esPro
    ? [
        "Cotizaciones ilimitadas",
        "CFDI — facturación electrónica automática",
        "Avisos por email al recibir solicitudes",
        "Empresas B2B con crédito por empresa",
      ]
    : [
        "Cotizaciones ilimitadas",
        'Botón "Solicitar cotización" en la tienda',
        "Precios negociados y descuentos",
        "Términos de crédito (Net 30 / Net 60)",
      ];

  return {
    nombre,
    precio,
    periodo: esAnual ? "USD / año" : "USD / mes",
    esPro,
    features,
  };
}

// Pasos que el comerciante puede marcar a mano (no se detectan solos).
const PASOS_MANUALES = ["boton", "cfdi"];

export default function Inicio() {
  const { activos, quotes, shopName, botonActivo, fiscalListo, themeEditorUrl } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const plan = infoPlan(activos);
  const tieneCotizaciones = quotes.length > 0;

  // Pasos marcados a mano se guardan en el navegador (localStorage).
  const [manuales, setManuales] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem("flouvia-onboarding");
      if (raw) setManuales(JSON.parse(raw));
    } catch {
      // ignoramos: localStorage puede no estar disponible
    }
  }, []);

  const marcar = (id: string) => {
    setManuales((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem("flouvia-onboarding", JSON.stringify(next));
      } catch {
        // ignoramos
      }
      return next;
    });
  };

  const pasos = [
    {
      id: "plan",
      titulo: "Activa tu plan",
      desc:
        activos.length > 0
          ? `¡Listo! Ya tienes el plan ${plan.nombre} activo. Tu prueba gratis de 7 días corre desde hoy.`
          : "Puedes usar el Plan Gratis desde hoy, o elegir un plan de pago para desbloquear todas las herramientas de cotización.",
      done: activos.length > 0,
      auto: true,
      cta: activos.length > 0 ? undefined : { label: "Ver planes", to: "/app/plans" },
    },
    {
      id: "boton",
      titulo: 'Activa el botón "Solicitar cotización" en tu tienda',
      desc: "Abre el editor de temas, entra a una página de producto y agrega el bloque «Solicitar cotización» de Flouvia. Así tus clientes B2B podrán pedir cotizaciones desde la tienda. Cuando llegue la primera solicitud, este paso se marcará solo.",
      done: botonActivo || !!manuales.boton,
      auto: botonActivo,
      manual: !botonActivo,
      linkExterno: { label: "Abrir editor de temas", href: themeEditorUrl },
    },
    {
      id: "cotizacion",
      titulo: "Crea tu primera cotización",
      desc: "Arma una cotización manual: elige productos, pon precios negociados y descuentos, y genera el link de pago para tu cliente.",
      done: tieneCotizaciones,
      auto: true,
      cta: { label: "Crear cotización", to: "/app/quotes/new" },
    },
    {
      id: "cfdi",
      titulo: "Configura tu facturación CFDI",
      desc: "Llena tus datos fiscales (RFC, razón social y régimen) en Configuración. Con eso, al cerrar una cotización podrás timbrar la factura CFDI 4.0 automáticamente. Al guardar tu RFC, este paso se marca solo.",
      done: fiscalListo || !!manuales.cfdi,
      auto: fiscalListo,
      manual: !fiscalListo,
      cta: { label: "Configurar datos fiscales", to: "/app/configuracion" },
      pro: true,
    },
  ];

  const completados = pasos.filter((p) => p.done).length;
  const total = pasos.length;

  return (
    <s-page heading={`¡Bienvenido${shopName ? `, ${shopName}` : ""}!`}>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/quotes/new")}
      >
        Nueva cotización
      </s-button>

      {/* Guía de primeros pasos */}
      <s-section heading="Primeros pasos">
        <s-stack gap="base">
          <s-stack
            direction="inline"
            gap="small-200"
            justifyContent="space-between"
            alignItems="center"
          >
            <s-paragraph>
              Sigue estos pasos para empezar a recibir y gestionar solicitudes
              de tus clientes.
            </s-paragraph>
            <s-badge tone={completados === total ? "success" : "info"}>
              {`${completados} de ${total} completados`}
            </s-badge>
          </s-stack>

          {pasos.map((p, i) => (
            <s-stack gap="small-200" key={p.id}>
              <s-divider />
              <s-stack
                direction="inline"
                gap="small-200"
                alignItems="center"
              >
                <s-badge tone={p.done ? "success" : "neutral"}>
                  {p.done ? "✓" : `${i + 1}`}
                </s-badge>
                <s-heading>{p.titulo}</s-heading>
                {p.pro ? <s-badge tone="info">Plan Pro</s-badge> : null}
              </s-stack>
              <s-paragraph color="subdued">{p.desc}</s-paragraph>
              <s-stack direction="inline" gap="small-200" alignItems="center">
                {/* Acción interna (navegar dentro de la app) */}
                {p.cta && !p.done ? (
                  <s-button
                    variant="primary"
                    onClick={() => navigate(p.cta!.to)}
                  >
                    {p.cta.label}
                  </s-button>
                ) : null}
                {/* Acción externa (abre el admin de Shopify en pestaña nueva,
                    fuera del iframe — un redirect aquí sale bloqueado) */}
                {p.linkExterno && !p.done ? (
                  <s-button
                    href={p.linkExterno.href}
                    target="_blank"
                    icon="external"
                  >
                    {p.linkExterno.label}
                  </s-button>
                ) : null}
                {/* Respaldo manual si no se pudo autodetectar */}
                {p.manual && !p.done ? (
                  <s-button variant="tertiary" onClick={() => marcar(p.id)}>
                    Ya lo hice
                  </s-button>
                ) : null}
                {/* Estados de "hecho" */}
                {p.done && p.auto ? (
                  <s-badge tone="success">
                    {PASOS_MANUALES.includes(p.id)
                      ? "Detectado automáticamente"
                      : "Completado"}
                  </s-badge>
                ) : null}
                {p.done && !p.auto ? (
                  <s-button variant="tertiary" onClick={() => marcar(p.id)}>
                    Desmarcar
                  </s-button>
                ) : null}
              </s-stack>
            </s-stack>
          ))}
        </s-stack>
      </s-section>

      {/* Tu plan */}
      <s-section heading="Tu plan">
        <s-stack gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-heading>{plan.nombre}</s-heading>
            {plan.esPro ? <s-badge tone="success">Pro</s-badge> : null}
          </s-stack>
          {plan.precio != null ? (
            <s-paragraph color="subdued">
              {`$${plan.precio} ${plan.periodo} · prueba gratis de 7 días`}
            </s-paragraph>
          ) : (
            <s-paragraph color="subdued">
              Sin costo. Cambia de plan cuando quieras.
            </s-paragraph>
          )}
          <s-unordered-list>
            {plan.features.map((f) => (
              <s-list-item key={f}>{f}</s-list-item>
            ))}
          </s-unordered-list>
          <s-stack direction="inline">
            <s-button onClick={() => navigate("/app/plans")}>
              {plan.esPro ? "Administrar plan" : "Ver planes"}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      {/* Actividad reciente */}
      <s-section heading="Actividad reciente">
        {quotes.length === 0 ? (
          <s-stack gap="small-200">
            <s-paragraph color="subdued">
              Todavía no hay cotizaciones. Crea la primera para verla aquí.
            </s-paragraph>
            <s-stack direction="inline">
              <s-button onClick={() => navigate("/app/quotes/new")}>
                Crear cotización
              </s-button>
            </s-stack>
          </s-stack>
        ) : (
          <s-stack gap="small-200">
            {quotes.map((q: any, idx: number) => {
              const solicitante = (q.customAttributes ?? []).find(
                (a: any) => a.key === "Solicitante",
              )?.value;
              const nombre =
                q.customer?.displayName ?? solicitante ?? "Sin cliente";
              const numericId = q.id.split("/").pop();
              return (
                <s-stack gap="small-200" key={q.id}>
                  {idx > 0 ? <s-divider /> : null}
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="center"
                    >
                      <s-link
                        onClick={() => navigate(`/app/quotes/${numericId}`)}
                      >
                        {q.name}
                      </s-link>
                      <s-badge tone={estadoTone(q.status)}>
                        {estadoLegible(q.status)}
                      </s-badge>
                      <s-text color="subdued">{nombre}</s-text>
                    </s-stack>
                    <s-text fontVariantNumeric="tabular-nums">
                      {formatoMoneda(
                        q.totalPriceSet.shopMoney.amount,
                        q.totalPriceSet.shopMoney.currencyCode,
                      )}
                    </s-text>
                  </s-stack>
                </s-stack>
              );
            })}
            <s-stack direction="inline">
              <s-button
                variant="tertiary"
                onClick={() => navigate("/app/quotes")}
              >
                Ver todas las cotizaciones
              </s-button>
            </s-stack>
          </s-stack>
        )}
      </s-section>

      {/* Ayuda */}
      <s-section heading="¿Necesitas ayuda?">
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
          gap="base"
        >
          <s-stack gap="small-200">
            <s-heading>Soporte por email</s-heading>
            <s-paragraph color="subdued">
              Escríbenos desde la app y te respondemos en menos de 24 horas
              hábiles, en español.
            </s-paragraph>
            <s-stack direction="inline">
              <s-button onClick={() => navigate("/app/contacto")}>
                Escribir a soporte
              </s-button>
            </s-stack>
          </s-stack>

          <s-stack gap="small-200">
            <s-heading>Configura tu app</s-heading>
            <s-paragraph color="subdued">
              Personaliza los correos, el PDF, tus datos fiscales y el botón de
              la tienda.
            </s-paragraph>
            <s-stack direction="inline">
              <s-button onClick={() => navigate("/app/configuracion")}>
                Abrir configuración
              </s-button>
            </s-stack>
          </s-stack>

          <s-stack gap="small-200">
            <s-heading>Guía rápida</s-heading>
            <s-paragraph color="subdued">
              Aprende a crear cotizaciones, manejar crédito B2B y facturar con
              CFDI.
            </s-paragraph>
            <s-stack direction="inline">
              <s-button onClick={() => navigate("/app/quotes/new")}>
                Crear mi primera cotización
              </s-button>
            </s-stack>
          </s-stack>
        </s-grid>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
