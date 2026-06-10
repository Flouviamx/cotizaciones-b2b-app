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

function estadoClase(status: string) {
  switch (status) {
    case "OPEN":
      return "open";
    case "INVOICE_SENT":
      return "sent";
    case "COMPLETED":
      return "paid";
    default:
      return "open";
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

  // Link directo al editor de temas (se abre en pestaña nueva, fuera del iframe).
  const themeEditorUrl = `https://${session.shop}/admin/themes/current/editor`;

  return { activos, quotes, shopName, botonActivo, fiscalListo, themeEditorUrl };
};

// Datos de presentación de cada plan (para la tarjeta "Tu plan").
function infoPlan(activos: string[]) {
  const nombre = activos[0] ?? null;
  if (!nombre) {
    return {
      nombre: "Sin plan activo",
      emoji: "✨",
      precio: null as number | null,
      periodo: "",
      esPro: false,
      features: [],
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
    emoji: esPro ? "🏆" : "🎖️",
    precio,
    periodo: esAnual ? "USD / año" : "USD / mes",
    esPro,
    features,
  };
}

const CSS = `
.dh-wrap { max-width: 1040px; margin: 0 auto; padding: 8px 16px 48px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; color: #1a1a2e; }

/* Hero */
.dh-hero { position: relative; overflow: hidden; border-radius: 20px; padding: 26px 28px;
  background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff;
  box-shadow: 0 14px 34px -12px rgba(26,115,232,.5); margin: 8px 0 22px; }
.dh-hero::after { content: ""; position: absolute; top: -60px; right: -40px; width: 220px; height: 220px;
  background: rgba(255,255,255,.12); border-radius: 50%; }
.dh-hero h1 { font-size: 26px; font-weight: 800; margin: 0 0 6px; letter-spacing: -0.02em; position: relative; }
.dh-hero p { font-size: 15px; margin: 0; opacity: .92; position: relative; max-width: 560px; }
.dh-plan-chip { display: inline-flex; align-items: center; gap: 7px; margin-top: 16px; position: relative;
  background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.3); backdrop-filter: blur(4px);
  padding: 7px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; }

/* Secciones */
.dh-section-title { font-size: 18px; font-weight: 750; margin: 26px 0 14px; letter-spacing: -0.01em; }

/* Guía de primeros pasos */
.dh-guide { background: #fff; border: 1px solid #ececf0; border-radius: 18px; padding: 22px 24px;
  box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.dh-progress-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.dh-progress-head .t { font-size: 14px; font-weight: 700; }
.dh-progress-head .c { font-size: 13px; font-weight: 700; color: #1a56c4; }
.dh-progress { height: 8px; background: #eef0f4; border-radius: 999px; overflow: hidden; margin-bottom: 20px; }
.dh-progress span { display: block; height: 100%; background: linear-gradient(90deg, #1a73e8, #4285f4);
  border-radius: 999px; transition: width .4s ease; }

.dh-step { display: flex; gap: 14px; padding: 14px 0; border-top: 1px solid #f1f1f4; }
.dh-step:first-of-type { border-top: 0; }
.dh-step .num { flex: 0 0 30px; width: 30px; height: 30px; border-radius: 999px; display: flex;
  align-items: center; justify-content: center; font-size: 14px; font-weight: 800;
  background: #eef3ff; color: #1a56c4; }
.dh-step.done .num { background: #dcfce7; color: #15803d; }
.dh-step .body { flex: 1; min-width: 0; }
.dh-step .body .st { font-size: 15px; font-weight: 700; margin: 2px 0 3px; }
.dh-step.done .body .st { color: #6b7280; text-decoration: line-through; text-decoration-color: #c9cdd6; }
.dh-step .body .sd { font-size: 13.5px; color: #6b7280; line-height: 1.5; }
.dh-step .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.dh-step .badge-pro { display: inline-block; background: #f3e8ff; color: #6b21a8; font-size: 11px;
  font-weight: 700; padding: 2px 8px; border-radius: 999px; margin-left: 6px; vertical-align: middle; }

.dh-btn { border: 0; border-radius: 10px; padding: 9px 15px; font-size: 13.5px; font-weight: 700;
  cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; transition: opacity .15s, background .15s; }
.dh-btn.primary { background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff; }
.dh-btn.primary:hover { opacity: .9; }
.dh-btn.ghost { background: #fff; border: 1.5px solid #d8d8e0; color: #374151; }
.dh-btn.ghost:hover { border-color: #1a73e8; color: #1a56c4; }
.dh-btn.ok { background: #dcfce7; color: #15803d; cursor: default; }

/* Grid plan + actividad */
.dh-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
.dh-card { background: #fff; border: 1px solid #ececf0; border-radius: 18px; padding: 22px 24px;
  box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.dh-card.plan { border: 1px solid #cfe0fc; background: linear-gradient(135deg, #f7faff, #eef5ff); }
.dh-card h3 { font-size: 15px; font-weight: 750; margin: 0 0 14px; display: flex; align-items: center; gap: 8px; }
.dh-plan-row { display: flex; align-items: baseline; gap: 8px; }
.dh-plan-row .nm { font-size: 19px; font-weight: 800; }
.dh-plan-row .emo { font-size: 22px; }
.dh-plan-price { margin: 4px 0 14px; font-size: 13px; color: #6b7280; font-weight: 600; }
.dh-plan-price b { color: #1a1a2e; font-size: 16px; font-weight: 800; }
.dh-feats { list-style: none; padding: 0; margin: 0 0 16px; display: grid; gap: 9px; }
.dh-feats li { display: flex; gap: 9px; font-size: 13.5px; color: #374151; }
.dh-feats .chk { flex: 0 0 18px; width: 18px; height: 18px; border-radius: 999px; background: #dcfce7;
  color: #16a34a; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; }

/* Actividad reciente */
.dh-act { display: grid; gap: 10px; }
.dh-act-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 11px 12px;
  border: 1px solid #f1f1f4; border-radius: 12px; cursor: pointer; transition: border-color .15s, background .15s; }
.dh-act-row:hover { border-color: #cfe0fc; background: #f7faff; }
.dh-act-row .nm { font-size: 13.5px; font-weight: 700; }
.dh-act-row .cl { font-size: 13px; color: #6b7280; }
.dh-act-row .am { margin-left: auto; font-size: 13px; font-weight: 700; white-space: nowrap;
  font-variant-numeric: tabular-nums; display: inline-flex; align-items: baseline; gap: 5px; }
.dh-act-row .am .cur { font-size: 10.5px; font-weight: 700; color: #9ca3af; }
.dh-badge { font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
.dh-badge.open { background: #e8f0fe; color: #1a56c4; }
.dh-badge.sent { background: #fef3c7; color: #92400e; }
.dh-badge.paid { background: #dcfce7; color: #15803d; }
.dh-empty { text-align: center; color: #6b7280; padding: 28px 16px; border: 1px dashed #d8d8e0;
  border-radius: 12px; background: #fafafb; font-size: 13.5px; }
.dh-link { display: inline-block; margin-top: 14px; color: #1a73e8; font-weight: 700; font-size: 13.5px;
  text-decoration: none; cursor: pointer; }
.dh-link:hover { text-decoration: underline; }

/* Ayuda / badges */
.dh-help { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
.dh-help-card { background: #fff; border: 1px solid #ececf0; border-radius: 16px; padding: 18px;
  display: flex; flex-direction: column; transition: box-shadow .15s, transform .15s; }
.dh-help-card:hover { box-shadow: 0 8px 22px -10px rgba(0,0,0,.16); transform: translateY(-1px); }
.dh-help-card .ic { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center;
  justify-content: center; font-size: 20px; background: linear-gradient(135deg, #e8f0fe, #eaf1fd); margin-bottom: 12px; }
.dh-help-card .ht { font-size: 14.5px; font-weight: 750; margin-bottom: 4px; }
.dh-help-card .hd { font-size: 13px; color: #6b7280; line-height: 1.5; flex: 1; margin-bottom: 14px; }

@media (max-width: 720px) {
  .dh-cols { grid-template-columns: 1fr; }
  .dh-hero h1 { font-size: 22px; }
}
`;

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
          : "Elige un plan (puedes empezar gratis) para desbloquear todas las herramientas de cotización.",
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
  const pct = Math.round((completados / total) * 100);

  return (
    <s-page heading="Inicio">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/quotes/new")}
      >
        Nueva cotización
      </s-button>

      <style>{CSS}</style>

      <div className="dh-wrap">
        {/* Hero de bienvenida */}
        <div className="dh-hero">
          <h1>
            ¡Bienvenido{shopName ? `, ${shopName}` : ""}! 👋
          </h1>
          <p>
            Tu portal de cotizaciones B2B está listo. Sigue estos pasos para
            empezar a recibir y gestionar solicitudes de tus clientes.
          </p>
          <span className="dh-plan-chip">
            {plan.emoji} Plan actual: {plan.nombre}
          </span>
        </div>

        {/* Guía de primeros pasos */}
        <div className="dh-section-title">Primeros pasos</div>
        <div className="dh-guide">
          <div className="dh-progress-head">
            <span className="t">Tu progreso</span>
            <span className="c">
              {completados} de {total} completados
            </span>
          </div>
          <div className="dh-progress">
            <span style={{ width: `${pct}%` }} />
          </div>

          {pasos.map((p, i) => (
            <div className={`dh-step ${p.done ? "done" : ""}`} key={p.id}>
              <div className="num">{p.done ? "✓" : i + 1}</div>
              <div className="body">
                <div className="st">
                  {p.titulo}
                  {p.pro ? <span className="badge-pro">PRO</span> : null}
                </div>
                <div className="sd">{p.desc}</div>
                <div className="actions">
                  {/* Acción interna (navegar dentro de la app) */}
                  {p.cta && !p.done ? (
                    <button
                      className="dh-btn primary"
                      onClick={() => navigate(p.cta!.to)}
                    >
                      {p.cta.label}
                    </button>
                  ) : null}
                  {/* Acción externa (abre el admin de Shopify en pestaña nueva,
                      fuera del iframe — un mailto/redirect aquí sale bloqueado) */}
                  {p.linkExterno && !p.done ? (
                    <a
                      className="dh-btn ghost"
                      href={p.linkExterno.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {p.linkExterno.label} ↗
                    </a>
                  ) : null}
                  {/* Respaldo manual si no se pudo autodetectar */}
                  {p.manual && !p.done ? (
                    <button
                      className="dh-btn ghost"
                      onClick={() => marcar(p.id)}
                    >
                      Ya lo hice
                    </button>
                  ) : null}
                  {/* Estados de "hecho" */}
                  {p.done && p.auto ? (
                    <span className="dh-btn ok">
                      {p.id === "boton" || p.id === "cfdi"
                        ? "✓ Detectado automáticamente"
                        : "✓ Completado"}
                    </span>
                  ) : null}
                  {p.done && !p.auto ? (
                    <button
                      className="dh-btn ghost"
                      onClick={() => marcar(p.id)}
                    >
                      Desmarcar
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Plan + Actividad reciente */}
        <div className="dh-section-title">Tu cuenta</div>
        <div className="dh-cols">
          {/* Detalles del plan */}
          <div className="dh-card plan">
            <h3>📦 Detalles del plan</h3>
            <div className="dh-plan-row">
              <span className="emo">{plan.emoji}</span>
              <span className="nm">{plan.nombre}</span>
            </div>
            {plan.precio != null ? (
              <div className="dh-plan-price">
                <b>${plan.precio}</b> {plan.periodo} · prueba gratis de 7 días
              </div>
            ) : (
              <div className="dh-plan-price">
                Aún no tienes un plan activo.
              </div>
            )}
            <ul className="dh-feats">
              {plan.features.map((f) => (
                <li key={f}>
                  <span className="chk">✓</span> {f}
                </li>
              ))}
            </ul>
            <button
              className="dh-btn ghost"
              onClick={() => navigate("/app/plans")}
            >
              {plan.esPro ? "Administrar plan" : "Cambiar a Pro →"}
            </button>
          </div>

          {/* Actividad reciente */}
          <div className="dh-card">
            <h3>🕑 Actividad reciente</h3>
            {quotes.length === 0 ? (
              <div className="dh-empty">
                Todavía no hay cotizaciones. Crea la primera para verla aquí.
              </div>
            ) : (
              <div className="dh-act">
                {quotes.map((q: any) => {
                  const solicitante = (q.customAttributes ?? []).find(
                    (a: any) => a.key === "Solicitante",
                  )?.value;
                  const nombre =
                    q.customer?.displayName ?? solicitante ?? "Sin cliente";
                  const numericId = q.id.split("/").pop();
                  return (
                    <div
                      className="dh-act-row"
                      key={q.id}
                      onClick={() => navigate(`/app/quotes/${numericId}`)}
                    >
                      <span className="nm">{q.name}</span>
                      <span className={`dh-badge ${estadoClase(q.status)}`}>
                        {estadoLegible(q.status)}
                      </span>
                      <span className="cl">— {nombre}</span>
                      <span className="am">
                        {formatoMoneda(
                          q.totalPriceSet.shopMoney.amount,
                          q.totalPriceSet.shopMoney.currencyCode,
                        )}
                        <span className="cur">
                          {q.totalPriceSet.shopMoney.currencyCode}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <span className="dh-link" onClick={() => navigate("/app/quotes")}>
              Ver todas las cotizaciones →
            </span>
          </div>
        </div>

        {/* Ayuda */}
        <div className="dh-section-title">¿Necesitas ayuda?</div>
        <div className="dh-help">
          <div className="dh-help-card">
            <div className="ic">✉️</div>
            <div className="ht">Soporte por email</div>
            <div className="hd">
              Escríbenos desde la app y te respondemos en menos de 24 horas
              hábiles, en español.
            </div>
            <button
              className="dh-btn primary"
              onClick={() => navigate("/app/contacto")}
            >
              Escribir a soporte
            </button>
          </div>

          <div className="dh-help-card">
            <div className="ic">⚙️</div>
            <div className="ht">Configura tu app</div>
            <div className="hd">
              Personaliza los correos, el PDF, tus datos fiscales y el botón de
              la tienda.
            </div>
            <button
              className="dh-btn ghost"
              onClick={() => navigate("/app/configuracion")}
            >
              Abrir configuración →
            </button>
          </div>

          <div className="dh-help-card">
            <div className="ic">📚</div>
            <div className="ht">Guía rápida</div>
            <div className="hd">
              Aprende a crear cotizaciones, manejar crédito B2B y facturar con
              CFDI.
            </div>
            <button
              className="dh-btn ghost"
              onClick={() => navigate("/app/quotes/new")}
            >
              Crear mi primera cotización
            </button>
          </div>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
