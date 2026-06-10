import { useEffect, useMemo, useRef, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { PLANES_PRO } from "../plans";
import { BILLING_TEST } from "../billing.server";

// Trae hasta 250 cotizaciones (Draft Orders) y deja que el cliente calcule los
// KPIs según el rango de fechas elegido. Así el filtro es instantáneo.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing } = await authenticate.admin(request);

  // Analítica es una función del Plan Pro. Sin Pro mostramos el teaser.
  const proCheck = await billing.check({ plans: PLANES_PRO as any, isTest: BILLING_TEST });
  if (!proCheck.hasActivePayment) {
    return { hasPro: false, quotes: [], currency: "MXN" };
  }
  const resp = await admin.graphql(
    `#graphql
      query analiticaQuotes {
        shop { currencyCode }
        draftOrders(first: 250, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              status
              createdAt
              customer { displayName }
              totalPriceSet { shopMoney { amount currencyCode } }
            }
          }
        }
      }`,
  );
  const json: any = await resp.json();
  const quotes = (json.data?.draftOrders?.edges ?? []).map((e: any) => {
    const n = e.node;
    return {
      id: n.id,
      name: n.name,
      status: n.status,
      createdAt: n.createdAt,
      cliente: n.customer?.displayName ?? "Sin cliente",
      monto: parseFloat(
        n.totalPriceSet?.shopMoney?.amount ?? "0",
      ),
    };
  });
  const currency = json.data?.shop?.currencyCode ?? "MXN";
  return { hasPro: true, quotes, currency };
};

const CSS = `
.an-wrap { max-width: 1040px; margin: 0 auto; padding: 8px 16px 48px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; color: #1a1a2e; }

.an-hero { position: relative; overflow: hidden; border-radius: 20px; padding: 26px 28px;
  background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff;
  box-shadow: 0 14px 34px -12px rgba(26,115,232,.5); margin: 8px 0 22px; }
.an-hero::after { content: ""; position: absolute; top: -60px; right: -40px; width: 220px; height: 220px;
  background: rgba(255,255,255,.12); border-radius: 50%; }
.an-hero h1 { font-size: 26px; font-weight: 800; margin: 0 0 6px; letter-spacing: -0.02em; position: relative; }
.an-hero p { font-size: 15px; margin: 0; opacity: .92; position: relative; max-width: 560px; }

/* Filtro de rango */
.an-range { display: inline-flex; gap: 4px; background: #fff; border: 1px solid #e2e2ea;
  border-radius: 12px; padding: 4px; margin-bottom: 20px; }
.an-range button { border: 0; background: transparent; border-radius: 9px; padding: 8px 15px;
  font-size: 13px; font-weight: 700; color: #6b7280; cursor: pointer; transition: all .15s; }
.an-range button.on { background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff;
  box-shadow: 0 6px 14px -7px rgba(26,115,232,.6); }
.an-range button:not(.on):hover { color: #1a56c4; }

/* KPI cards */
.an-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 24px; }
.an-kpi { background: #fff; border: 1px solid #ececf0; border-radius: 16px; padding: 18px 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,.04); position: relative; overflow: hidden; }
.an-kpi .ic { width: 38px; height: 38px; border-radius: 11px; display: flex; align-items: center;
  justify-content: center; font-size: 18px; background: linear-gradient(135deg, #e8f0fe, #eaf1fd); margin-bottom: 12px; }
.an-kpi .lbl { font-size: 13px; color: #6b7280; font-weight: 600; }
.an-kpi .num { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; margin-top: 3px; }
.an-kpi.accent { border-color: #cfe0fc; background: linear-gradient(135deg, #f6faff, #eef5ff); }
.an-kpi.accent .num { color: #1a56c4; }
.an-kpi.good { border-color: #bbf7d0; background: linear-gradient(135deg, #f3fdf6, #ecfdf2); }
.an-kpi.good .num { color: #15803d; }
.an-kpi.good .ic { background: linear-gradient(135deg, #dcfce7, #d1fae5); }

.an-section-title { font-size: 18px; font-weight: 750; margin: 4px 0 14px; letter-spacing: -0.01em; }
.an-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
.an-card { background: #fff; border: 1px solid #ececf0; border-radius: 18px; padding: 22px 24px;
  box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.an-card h3 { font-size: 15px; font-weight: 750; margin: 0 0 18px; display: flex; align-items: center; gap: 8px; }

/* Embudo de estados */
.an-funnel { display: grid; gap: 14px; }
.an-frow .top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
.an-frow .top .nm { font-size: 13.5px; font-weight: 700; }
.an-frow .top .vl { font-size: 13px; color: #6b7280; font-weight: 700; }
.an-bar { height: 12px; background: #eef0f4; border-radius: 999px; overflow: hidden; }
.an-bar span { display: block; height: 100%; border-radius: 999px; transition: width .7s cubic-bezier(.2,.8,.3,1); }
.an-bar span.open { background: linear-gradient(90deg, #1a73e8, #4285f4); }
.an-bar span.sent { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
.an-bar span.paid { background: linear-gradient(90deg, #16a34a, #22c55e); }

/* Tendencia por mes */
.an-chart { display: flex; align-items: flex-end; gap: 10px; height: 170px; padding-top: 10px; }
.an-chart .col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; height: 100%; justify-content: flex-end; }
.an-chart .col .bar { width: 100%; max-width: 42px; border-radius: 8px 8px 0 0;
  background: linear-gradient(180deg, #4285f4, #1a73e8); transition: height .7s cubic-bezier(.2,.8,.3,1);
  min-height: 3px; position: relative; }
.an-chart .col .bar .cap { position: absolute; top: -19px; left: 0; right: 0; text-align: center;
  font-size: 11.5px; font-weight: 800; color: #1a56c4; }
.an-chart .col .mlbl { font-size: 11.5px; color: #9099a8; font-weight: 700; text-transform: capitalize; }

/* Top clientes */
.an-top { display: grid; gap: 10px; }
.an-top-row { display: flex; align-items: center; gap: 12px; padding: 11px 12px; border: 1px solid #f1f1f4;
  border-radius: 12px; }
.an-top-row .rk { flex: 0 0 26px; width: 26px; height: 26px; border-radius: 999px; background: #eef3ff;
  color: #1a56c4; font-size: 12.5px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.an-top-row .rk.gold { background: #fef3c7; color: #92400e; }
.an-top-row .nm { font-size: 13.5px; font-weight: 700; flex: 1; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.an-top-row .meta { font-size: 12px; color: #9099a8; font-weight: 600; }
.an-top-row .am { font-size: 13.5px; font-weight: 800; margin-left: auto; }

.an-empty { text-align: center; color: #6b7280; padding: 30px 16px; border: 1px dashed #d8d8e0;
  border-radius: 14px; background: #fafafb; font-size: 14px; }

/* Teaser Pro (sin plan) */
.an-lock { background: linear-gradient(135deg, #f7faff, #eef5ff); border: 1px solid #cfe0fc;
  border-radius: 20px; padding: 40px 32px; text-align: center; }
.an-lock .ic { font-size: 46px; margin-bottom: 14px; }
.an-lock .t { font-size: 20px; font-weight: 800; margin-bottom: 8px; letter-spacing: -0.02em; }
.an-lock .d { font-size: 14.5px; color: #4b5563; line-height: 1.6; max-width: 480px; margin: 0 auto 22px; }
.an-lock .feats { display: grid; gap: 10px; max-width: 380px; margin: 0 auto 24px; text-align: left;
  list-style: none; padding: 0; }
.an-lock .feats li { display: flex; gap: 9px; font-size: 14px; color: #374151; }
.an-lock .feats .chk { flex: 0 0 20px; width: 20px; height: 20px; border-radius: 999px; background: #dcfce7;
  color: #16a34a; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; }
.an-lock .cta { border: 0; border-radius: 12px; padding: 13px 28px; font-size: 15px; font-weight: 800;
  cursor: pointer; color: #fff; background: linear-gradient(135deg, #1a73e8, #4285f4);
  box-shadow: 0 10px 24px -10px rgba(26,115,232,.6); }
.an-lock .cta:hover { opacity: .92; }

@media (max-width: 760px) { .an-cols { grid-template-columns: 1fr; } .an-hero h1 { font-size: 22px; } }
`;

const RANGOS: { id: string; label: string; dias: number | null }[] = [
  { id: "7", label: "7 días", dias: 7 },
  { id: "30", label: "30 días", dias: 30 },
  { id: "90", label: "90 días", dias: 90 },
  { id: "todo", label: "Todo", dias: null },
];

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// Contador animado de 0 → valor.
function useCountUp(target: number, duracion = 700) {
  const [val, setVal] = useState(0);
  const ref = useRef<number>(0);
  useEffect(() => {
    let raf = 0;
    const desde = ref.current;
    const inicio = performance.now();
    const tick = (ahora: number) => {
      const t = Math.min(1, (ahora - inicio) / duracion);
      const ease = 1 - Math.pow(1 - t, 3);
      const actual = desde + (target - desde) * ease;
      setVal(actual);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        ref.current = target;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duracion]);
  return val;
}

type Quote = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  cliente: string;
  monto: number;
};

export default function Analitica() {
  const data = useLoaderData<typeof loader>();
  const quotes = data.quotes as Quote[];
  const currency = data.currency;
  const navigate = useNavigate();
  const [rango, setRango] = useState("30");

  const fmtMoney = useMemo(
    () =>
      new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }),
    [currency],
  );

  // Filtra por rango de fechas (en el cliente).
  const filtrados = useMemo(() => {
    const cfg = RANGOS.find((r) => r.id === rango);
    if (!cfg || cfg.dias == null) return quotes;
    const limite = Date.now() - cfg.dias * 86400000;
    return quotes.filter((q) => new Date(q.createdAt).getTime() >= limite);
  }, [quotes, rango]);

  const m = useMemo(() => {
    const total = filtrados.length;
    const abiertas = filtrados.filter((q) => q.status === "OPEN");
    const enviadas = filtrados.filter((q) => q.status === "INVOICE_SENT");
    const pagadas = filtrados.filter((q) => q.status === "COMPLETED");
    const ingresos = pagadas.reduce((s, q) => s + q.monto, 0);
    const pipeline = [...abiertas, ...enviadas].reduce((s, q) => s + q.monto, 0);
    const conversion = total > 0 ? (pagadas.length / total) * 100 : 0;
    const ticket = total > 0
      ? filtrados.reduce((s, q) => s + q.monto, 0) / total
      : 0;

    // Top clientes por monto total.
    const porCliente = new Map<string, { monto: number; n: number }>();
    for (const q of filtrados) {
      const cur = porCliente.get(q.cliente) ?? { monto: 0, n: 0 };
      cur.monto += q.monto;
      cur.n += 1;
      porCliente.set(q.cliente, cur);
    }
    const top = [...porCliente.entries()]
      .map(([nombre, v]) => ({ nombre, ...v }))
      .sort((a, b) => b.monto - a.monto)
      .slice(0, 5);

    // Tendencia: últimos 6 meses (conteo de cotizaciones por mes).
    const ahora = new Date();
    const meses: { etiqueta: string; key: string; n: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
      meses.push({
        etiqueta: MESES[d.getMonth()],
        key: `${d.getFullYear()}-${d.getMonth()}`,
        n: 0,
      });
    }
    const idx = new Map(meses.map((mm, i) => [mm.key, i]));
    for (const q of quotes) {
      const d = new Date(q.createdAt);
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      const i = idx.get(k);
      if (i != null) meses[i].n += 1;
    }
    const maxMes = Math.max(1, ...meses.map((mm) => mm.n));

    return {
      total,
      abiertas: abiertas.length,
      enviadas: enviadas.length,
      pagadas: pagadas.length,
      ingresos,
      pipeline,
      conversion,
      ticket,
      top,
      meses,
      maxMes,
    };
  }, [filtrados, quotes]);

  const ingresosAnim = useCountUp(m.ingresos);
  const conversionAnim = useCountUp(m.conversion);
  const totalAnim = useCountUp(m.total);
  const pipelineAnim = useCountUp(m.pipeline);
  const ticketAnim = useCountUp(m.ticket);

  const maxFunnel = Math.max(1, m.abiertas, m.enviadas, m.pagadas);

  // -------- Teaser Pro (sin plan) --------
  if (!data.hasPro) {
    return (
      <s-page heading="Analítica">
        <s-button slot="breadcrumbs" variant="tertiary" href="/app" icon="arrow-left">
          Inicio
        </s-button>
        <style>{CSS}</style>
        <div className="an-wrap">
          <div className="an-lock">
            <div className="ic">📊🔒</div>
            <div className="t">Analítica es una función del Plan Pro</div>
            <div className="d">
              Mide el pulso de tu negocio B2B: ingresos cobrados, valor en
              pipeline, conversión de cotizaciones a ventas y tus mejores
              clientes — todo en un panel claro.
            </div>
            <ul className="feats">
              <li><span className="chk">✓</span> Ingresos cobrados y valor en pipeline</li>
              <li><span className="chk">✓</span> Tasa de conversión y ticket promedio</li>
              <li><span className="chk">✓</span> Embudo de cotizaciones y tendencia por mes</li>
              <li><span className="chk">✓</span> Top de clientes por monto cotizado</li>
            </ul>
            <button className="cta" onClick={() => navigate("/app/plans")}>
              Subir al Plan Pro
            </button>
          </div>
        </div>
      </s-page>
    );
  }

  return (
    <s-page heading="Analítica">
      <s-button slot="breadcrumbs" variant="tertiary" href="/app" icon="arrow-left">
        Inicio
      </s-button>

      <style>{CSS}</style>

      <div className="an-wrap">
        <div className="an-hero">
          <h1>Analítica 📊</h1>
          <p>
            El pulso de tu negocio B2B: ingresos, conversión de cotizaciones a
            ventas y tus mejores clientes — de un vistazo.
          </p>
        </div>

        <div className="an-range">
          {RANGOS.map((r) => (
            <button
              key={r.id}
              className={rango === r.id ? "on" : ""}
              onClick={() => setRango(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* KPIs */}
        <div className="an-kpis">
          <div className="an-kpi good">
            <div className="ic">💰</div>
            <div className="lbl">Ingresos cobrados</div>
            <div className="num">{fmtMoney.format(ingresosAnim)}</div>
          </div>
          <div className="an-kpi accent">
            <div className="ic">⏳</div>
            <div className="lbl">Valor en pipeline</div>
            <div className="num">{fmtMoney.format(pipelineAnim)}</div>
          </div>
          <div className="an-kpi">
            <div className="ic">🎯</div>
            <div className="lbl">Tasa de conversión</div>
            <div className="num">{conversionAnim.toFixed(1)}%</div>
          </div>
          <div className="an-kpi">
            <div className="ic">🧾</div>
            <div className="lbl">Cotizaciones</div>
            <div className="num">{Math.round(totalAnim)}</div>
          </div>
          <div className="an-kpi">
            <div className="ic">📦</div>
            <div className="lbl">Ticket promedio</div>
            <div className="num">{fmtMoney.format(ticketAnim)}</div>
          </div>
        </div>

        {m.total === 0 ? (
          <div className="an-empty">
            No hay cotizaciones en este rango. Prueba con un periodo más amplio o
            crea tu primera cotización.
          </div>
        ) : (
          <>
            <div className="an-section-title">Detalle</div>
            <div className="an-cols">
              {/* Embudo de estados */}
              <div className="an-card">
                <h3>🔄 Embudo de cotizaciones</h3>
                <div className="an-funnel">
                  <div className="an-frow">
                    <div className="top">
                      <span className="nm">Abiertas</span>
                      <span className="vl">{m.abiertas}</span>
                    </div>
                    <div className="an-bar">
                      <span
                        className="open"
                        style={{ width: `${(m.abiertas / maxFunnel) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="an-frow">
                    <div className="top">
                      <span className="nm">Enviadas (link de pago)</span>
                      <span className="vl">{m.enviadas}</span>
                    </div>
                    <div className="an-bar">
                      <span
                        className="sent"
                        style={{ width: `${(m.enviadas / maxFunnel) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="an-frow">
                    <div className="top">
                      <span className="nm">Pagadas</span>
                      <span className="vl">{m.pagadas}</span>
                    </div>
                    <div className="an-bar">
                      <span
                        className="paid"
                        style={{ width: `${(m.pagadas / maxFunnel) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Tendencia por mes (siempre sobre el total, últimos 6 meses) */}
              <div className="an-card">
                <h3>📈 Cotizaciones por mes</h3>
                <div className="an-chart">
                  {m.meses.map((mm) => (
                    <div className="col" key={mm.key}>
                      <div
                        className="bar"
                        style={{ height: `${(mm.n / m.maxMes) * 100}%` }}
                      >
                        {mm.n > 0 ? <span className="cap">{mm.n}</span> : null}
                      </div>
                      <div className="mlbl">{mm.etiqueta}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Top clientes */}
            <div className="an-section-title">Mejores clientes</div>
            <div className="an-card">
              <h3>🏅 Top 5 por monto cotizado</h3>
              <div className="an-top">
                {m.top.map((c, i) => (
                  <div className="an-top-row" key={c.nombre}>
                    <span className={`rk ${i === 0 ? "gold" : ""}`}>
                      {i + 1}
                    </span>
                    <span className="nm">{c.nombre}</span>
                    <span className="meta">
                      {c.n} {c.n === 1 ? "cotización" : "cotizaciones"}
                    </span>
                    <span className="am">{fmtMoney.format(c.monto)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
