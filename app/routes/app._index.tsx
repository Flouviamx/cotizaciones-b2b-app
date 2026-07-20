import { useEffect, useState, type ReactNode } from "react";
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
import { evaluarLimite } from "../limites.server";
import { Progreso } from "../components/Progreso";

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

// Fila de acción del sidebar: ícono neutral + link azul, sin chrome de botón
// — el mismo patrón compacto que usan las apps top del App Store en su
// Centro de soporte ("💬 Iniciar chat", "📖 Guía", "✉️ Correo").
function FilaAccion({
  icon,
  children,
  onClick,
  href,
  target,
}: {
  icon: string;
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  target?: string;
}) {
  return (
    <s-stack direction="inline" gap="small-300" alignItems="center">
      <s-icon type={icon as any} tone="neutral" size="small" />
      <s-link onClick={onClick} href={href} target={target}>
        {children}
      </s-link>
    </s-stack>
  );
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

  // Uso del plan (cotizaciones activas vs. tope del Plan Gratis) para la
  // tarjeta "Estado de tu cuenta" de la barra lateral.
  const limite = await evaluarLimite(admin);

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

  return {
    activos,
    quotes,
    shopName,
    botonActivo,
    fiscalListo,
    themeEditorUrl,
    limite,
  };
};

// Datos de presentación del plan activo (para la barra lateral).
function infoPlan(activos: string[]) {
  const nombre = activos[0] ?? null;
  if (!nombre) {
    return {
      nombre: "Gratis",
      precio: null as number | null,
      periodo: "",
      esPro: false,
    };
  }
  const esPro = PLANES_PRO.includes(nombre);
  const esAnual = nombre.includes("Anual");
  let precio = PRECIO_BASICO_MENSUAL;
  if (nombre === PLAN_BASICO_MENSUAL) precio = PRECIO_BASICO_MENSUAL;
  else if (nombre === PLAN_BASICO_ANUAL) precio = PRECIO_BASICO_ANUAL;
  else if (nombre === PLAN_PRO_MENSUAL) precio = PRECIO_PRO_MENSUAL;
  else if (nombre === PLAN_PRO_ANUAL) precio = PRECIO_PRO_ANUAL;

  return {
    nombre,
    precio,
    periodo: esAnual ? "USD / año" : "USD / mes",
    esPro,
  };
}

// Pasos que el comerciante puede marcar a mano (no se detectan solos).
const PASOS_MANUALES = ["boton", "cfdi"];

export default function Inicio() {
  const {
    activos,
    quotes,
    shopName,
    botonActivo,
    fiscalListo,
    themeEditorUrl,
    limite,
  } = useLoaderData<typeof loader>();
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

  const botonListo = botonActivo || !!manuales.boton;

  const pasos = [
    {
      id: "boton",
      titulo: 'Activa el botón "Solicitar cotización" en tu tienda',
      desc: "Abre el editor de temas y enciende la incrustación de Flouvia. Así tus clientes B2B podrán pedir cotizaciones desde tu tienda. Cuando llegue la primera solicitud, este paso se marca solo.",
      done: botonListo,
      auto: botonActivo,
      manual: !botonActivo,
      linkExterno: { label: "Abrir editor de temas", href: themeEditorUrl },
    },
    {
      id: "cotizacion",
      titulo: "Crea tu primera cotización",
      desc: "Elige productos, pon precios negociados y descuentos, y genera el link de pago para tu cliente.",
      done: tieneCotizaciones,
      auto: true,
      cta: { label: "Crear cotización", to: "/app/quotes/new" },
    },
    {
      id: "cfdi",
      titulo: "Configura tu facturación CFDI",
      desc: "Captura tu RFC, razón social y régimen fiscal. Con eso podrás timbrar facturas CFDI 4.0 automáticamente al cerrar una cotización.",
      done: fiscalListo || !!manuales.cfdi,
      auto: fiscalListo,
      manual: !fiscalListo,
      cta: { label: "Configurar datos fiscales", to: "/app/configuracion" },
      pro: true,
    },
    {
      id: "plan",
      titulo: "Elige el plan que necesitas",
      desc:
        activos.length > 0
          ? `Ya tienes el plan ${plan.nombre} activo.`
          : "Estás en el Plan Gratis (hasta 5 cotizaciones activas). Mejora tu plan cuando lo necesites — cancela cuando quieras.",
      done: activos.length > 0,
      auto: true,
      cta: { label: "Ver planes", to: "/app/plans" },
    },
  ];

  const completados = pasos.filter((p) => p.done).length;
  const total = pasos.length;
  const pctOnboarding = Math.round((completados / total) * 100);

  // Uso de cotizaciones del Plan Gratis (barra lateral).
  const pctUso =
    limite.paid || limite.limite === 0
      ? 0
      : Math.min(100, (limite.activas / limite.limite) * 100);

  return (
    <s-page heading={shopName ? `Hola, ${shopName}` : "Inicio"}>
      <s-badge slot="accessory" tone={plan.esPro ? "success" : "info"}>
        {`Plan ${plan.nombre}`}
      </s-badge>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/quotes/new")}
      >
        Nueva cotización
      </s-button>

      {/* Acción requerida: sin el botón activo en la tienda, la app no recibe
          solicitudes. Es lo primero que debe resolver el comerciante. */}
      {!botonListo ? (
        <s-banner tone="warning" heading="Acción requerida">
          <s-paragraph>
            Para que Flouvia funcione en tu tienda, activa la incrustación de la
            app en el editor de temas. Sin esto, tus clientes no verán el botón
            para solicitar cotizaciones.
          </s-paragraph>
          <s-button
            slot="primary-action"
            href={themeEditorUrl}
            target="_blank"
            variant="primary"
          >
            Activar ahora
          </s-button>
        </s-banner>
      ) : null}

      {/* Guía de primeros pasos con barra de progreso */}
      <s-section heading="Primeros pasos">
        <s-stack gap="large-100">
          <s-stack gap="small-200">
            <s-paragraph color="subdued">
              Configura tu portal de cotizaciones B2B en cuatro pasos.
            </s-paragraph>
            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-text>
                {completados} de {total} tareas completadas
              </s-text>
              <s-text color="subdued">{`${pctOnboarding}%`}</s-text>
            </s-stack>
            <Progreso pct={pctOnboarding} />
          </s-stack>

          {pasos.map((p, i) => (
            <s-stack gap="small-200" key={p.id}>
              <s-divider />
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-badge tone={p.done ? "success" : "neutral"}>
                  {p.done ? "✓" : `${i + 1}`}
                </s-badge>
                <s-heading>{p.titulo}</s-heading>
                {p.pro ? <s-badge tone="info">Pro</s-badge> : null}
              </s-stack>
              <s-paragraph color="subdued">{p.desc}</s-paragraph>
              <s-stack direction="inline" gap="small-200" alignItems="center">
                {p.cta && !p.done ? (
                  <s-button onClick={() => navigate(p.cta!.to)}>
                    {p.cta.label}
                  </s-button>
                ) : null}
                {p.linkExterno && !p.done ? (
                  <s-button
                    href={p.linkExterno.href}
                    target="_blank"
                    icon="external"
                  >
                    {p.linkExterno.label}
                  </s-button>
                ) : null}
                {p.manual && !p.done ? (
                  <s-button variant="tertiary" onClick={() => marcar(p.id)}>
                    Ya lo hice
                  </s-button>
                ) : null}
                {p.done && p.auto ? (
                  <s-text color="subdued">
                    {PASOS_MANUALES.includes(p.id)
                      ? "Detectado automáticamente"
                      : "Completado"}
                  </s-text>
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

      {/* Actividad reciente */}
      <s-section heading="Actividad reciente">
        <s-button
          slot="primary-action"
          variant="tertiary"
          onClick={() => navigate("/app/quotes")}
        >
          Ver todas
        </s-button>
        {quotes.length === 0 ? (
          <s-stack gap="small-200">
            <s-paragraph color="subdued">
              Todavía no hay cotizaciones. Crea la primera o espera a que un
              cliente la solicite desde tu tienda.
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
          </s-stack>
        )}
      </s-section>

      {/* ---------------- Barra lateral ---------------- */}
      <s-stack slot="aside" gap="base">
        {/* Estado de incrustación en la tienda */}
        <s-section heading="Estado en tu tienda">
          <s-stack gap="small-200">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 999,
                  background: botonListo ? "#29845a" : "#b28400",
                  display: "inline-block",
                  boxShadow: botonListo
                    ? "0 0 0 3px rgba(41,132,90,0.15)"
                    : "0 0 0 3px rgba(178,132,0,0.15)",
                }}
              />
              <s-text>
                {botonListo ? "App incrustada y activa" : "App no incrustada"}
              </s-text>
            </s-stack>
            <s-paragraph color="subdued">
              {botonListo
                ? "Tus clientes ya pueden solicitar cotizaciones desde tu tienda."
                : "Activa la incrustación en el editor de temas para recibir solicitudes."}
            </s-paragraph>
            {!botonListo ? (
              <s-stack direction="inline">
                <s-button href={themeEditorUrl} target="_blank" icon="external">
                  Activar en el tema
                </s-button>
              </s-stack>
            ) : null}
          </s-stack>
        </s-section>

        {/* Estado de la cuenta — acción en el header de la tarjeta, no al
            final (mismo patrón que "Actualizar plan" en apps top del App Store) */}
        <s-section heading="Estado de tu cuenta">
          <s-button
            slot="primary-action"
            variant="tertiary"
            onClick={() => navigate("/app/plans")}
          >
            {limite.paid ? "Administrar" : "Actualizar"}
          </s-button>
          <s-stack gap="base">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text color="subdued">Plan actual:</s-text>
              <s-badge tone={plan.esPro ? "success" : "info"}>
                {plan.nombre}
              </s-badge>
            </s-stack>
            {plan.precio != null ? (
              <s-text color="subdued">
                {`$${plan.precio} ${plan.periodo}`}
              </s-text>
            ) : null}

            {limite.paid ? (
              <s-stack gap="small-300">
                <s-text color="subdued">Cotizaciones: ilimitadas</s-text>
              </s-stack>
            ) : (
              <s-stack gap="small-300">
                <s-stack direction="inline" justifyContent="space-between">
                  <s-text color="subdued">Cotizaciones activas</s-text>
                  <s-text fontVariantNumeric="tabular-nums">
                    {`${limite.activas} / ${limite.limite}`}
                  </s-text>
                </s-stack>
                <Progreso
                  pct={pctUso}
                  color={pctUso >= 100 ? "#c5280c" : undefined}
                />
                {limite.bloqueado ? (
                  <s-text tone="critical">
                    Llegaste al tope del Plan Gratis. Marca cotizaciones como
                    pagadas o mejora tu plan.
                  </s-text>
                ) : null}
              </s-stack>
            )}
          </s-stack>
        </s-section>

        {/* Centro de soporte — filas compactas de ícono + link, sin chrome
            de botón (mismo patrón denso que "💬 Iniciar chat en vivo /
            📖 Guía / ✉️ Correo" de las apps top del App Store) */}
        <s-section heading="Centro de soporte">
          <s-stack gap="small-400">
            <FilaAccion icon="chat" onClick={() => navigate("/app/contacto")}>
              Contactar soporte
            </FilaAccion>
            <FilaAccion
              icon="settings"
              onClick={() => navigate("/app/configuracion")}
            >
              Configuración de la app
            </FilaAccion>
            <FilaAccion
              icon="edit"
              onClick={() => navigate("/app/formulario")}
            >
              Personalizar el formulario
            </FilaAccion>
            <FilaAccion icon="theme-edit" href={themeEditorUrl} target="_blank">
              Editor de temas
            </FilaAccion>
            <s-divider />
            <s-text color="subdued">
              Te respondemos en menos de 24 horas hábiles, en español.
            </s-text>
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
