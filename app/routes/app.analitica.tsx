import { useEffect, useMemo, useRef, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { PLANES_PRO, cuotaCFDI } from "../plans";
import { BILLING_TEST } from "../billing.server";
import prisma from "../db.server";

// Paginamos los Draft Orders (hasta MAX_PAGES × 100) para que los KPIs sean
// fieles aunque el comerciante tenga mucho volumen, y dejamos que el cliente
// calcule todo según el rango elegido. Así el filtro es instantáneo.
const MAX_PAGES = 10;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);

  // Analítica es una función del Plan Pro. Sin Pro mostramos el teaser.
  const proCheck = await billing.check({ plans: PLANES_PRO as any, isTest: BILLING_TEST });
  if (!proCheck.hasActivePayment) {
    return { hasPro: false, quotes: [], currency: "MXN", cfdi: null };
  }

  // Trae todas las páginas de cotizaciones (con line items, empresa, términos y
  // fecha de cierre — necesarios para top productos, desglose B2B y tiempo de
  // cierre). Si una página falla (throttle), usamos lo acumulado.
  const quotes: any[] = [];
  let currency = "MXN";
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const resp = await admin.graphql(
      `#graphql
        query analiticaQuotes($cursor: String) {
          shop { currencyCode }
          draftOrders(first: 100, after: $cursor, sortKey: UPDATED_AT, reverse: true) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                name
                status
                createdAt
                completedAt
                customer { displayName }
                purchasingEntity {
                  __typename
                  ... on PurchasingCompany { company { id name } }
                }
                totalPriceSet { shopMoney { amount currencyCode } }
                customAttributes { key value }
                lineItems(first: 10) {
                  edges { node { title quantity } }
                }
              }
            }
          }
        }`,
      { variables: { cursor } },
    );
    const json: any = await resp.json();
    const conn = json.data?.draftOrders;
    if (!conn) break;
    if (json.data?.shop?.currencyCode) currency = json.data.shop.currencyCode;
    for (const e of conn.edges ?? []) {
      const n = e.node;
      quotes.push({
        id: n.id,
        name: n.name,
        status: n.status,
        createdAt: n.createdAt,
        completedAt: n.completedAt ?? null,
        cliente: n.customer?.displayName ?? "Sin cliente",
        empresa: n.purchasingEntity?.company?.name ?? "",
        terminos:
          (n.customAttributes ?? []).find(
            (a: any) => a.key === "Términos de crédito",
          )?.value ?? "",
        monto: parseFloat(n.totalPriceSet?.shopMoney?.amount ?? "0"),
        productos: (n.lineItems?.edges ?? []).map((le: any) => ({
          titulo: le.node.title,
          cantidad: le.node.quantity ?? 0,
        })),
      });
    }
    cursor = conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
    if (!cursor) break;
  }

  // Uso de CFDI del mes en curso (cuota del plan + excedente cobrado).
  const now = new Date();
  const periodo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const planName =
    proCheck.appSubscriptions?.find((s: any) => PLANES_PRO.includes(s.name))?.name ?? "";
  const { limite, extra, esPlus } = cuotaCFDI(planName);
  let timbrados = 0;
  let extraCobrado = 0;
  try {
    const fila = await prisma.cfdiUsage.findUnique({
      where: { shop_periodo: { shop: session.shop, periodo } },
    });
    timbrados = fila?.timbrados ?? 0;
    extraCobrado = fila?.extraCobrado ?? 0;
  } catch (e) {
    console.error("analitica: lectura CfdiUsage falló", e);
  }

  return {
    hasPro: true,
    quotes,
    currency,
    cfdi: { plan: esPlus ? "plus" : "pro", timbrados, limite, extra, extraCobrado, periodo },
  };
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

/* Chip de variación vs periodo anterior */
.an-delta { display: inline-flex; align-items: center; gap: 3px; margin-top: 7px;
  font-size: 12px; font-weight: 800; padding: 2px 8px; border-radius: 999px; }
.an-delta.up { color: #15803d; background: #dcfce7; }
.an-delta.down { color: #b91c1c; background: #fee2e2; }
.an-delta.flat { color: #6b7280; background: #eef0f4; }
.an-delta .prev { font-weight: 600; opacity: .75; }

/* Franja de insights */
.an-insights { display: grid; gap: 10px; margin: 0 0 22px; }
.an-insight { display: flex; align-items: center; gap: 12px; padding: 13px 16px; border-radius: 14px;
  font-size: 14px; font-weight: 600; line-height: 1.4; border: 1px solid; }
.an-insight .ic { font-size: 20px; flex: 0 0 auto; }
.an-insight.good { background: linear-gradient(135deg, #f3fdf6, #ecfdf2); border-color: #bbf7d0; color: #14532d; }
.an-insight.warn { background: linear-gradient(135deg, #fffbeb, #fef9ec); border-color: #fde68a; color: #92400e; }
.an-insight.info { background: linear-gradient(135deg, #f6faff, #eef5ff); border-color: #cfe0fc; color: #1e3a8a; }
.an-insight b { font-weight: 850; }

/* Toolbar (rango + exportar) */
.an-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  flex-wrap: wrap; margin-bottom: 20px; }
.an-export { display: inline-flex; gap: 8px; }
.an-export button { border: 1px solid #e2e2ea; background: #fff; border-radius: 10px; padding: 8px 14px;
  font-size: 13px; font-weight: 700; color: #374151; cursor: pointer; transition: all .15s;
  display: inline-flex; align-items: center; gap: 6px; }
.an-export button:hover { border-color: #1a73e8; color: #1a56c4; background: #f6faff; }

/* Cotizaciones estancadas */
.an-stuck { background: linear-gradient(135deg, #fffaf3, #fff6ea); border: 1px solid #fde0b2;
  border-radius: 18px; padding: 20px 22px; margin-bottom: 24px; }
.an-stuck.zero { background: linear-gradient(135deg, #f3fdf6, #ecfdf2); border-color: #bbf7d0; }
.an-stuck h3 { font-size: 15px; font-weight: 800; margin: 0 0 4px; display: flex; align-items: center; gap: 8px; }
.an-stuck .sub { font-size: 13px; color: #6b7280; margin: 0 0 16px; font-weight: 600; }
.an-stuck .risk { color: #b45309; font-weight: 850; }
.an-stuck-list { display: grid; gap: 8px; }
.an-stuck-row { display: flex; align-items: center; gap: 12px; padding: 11px 13px; background: #fff;
  border: 1px solid #f1e4cf; border-radius: 12px; cursor: pointer; transition: all .15s; }
.an-stuck-row:hover { border-color: #f59e0b; box-shadow: 0 4px 12px -6px rgba(245,158,11,.4); transform: translateY(-1px); }
.an-stuck-row .nm { font-size: 13.5px; font-weight: 750; }
.an-stuck-row .cli { font-size: 12.5px; color: #6b7280; font-weight: 600; }
.an-stuck-row .age { margin-left: auto; font-size: 12px; font-weight: 800; color: #b45309;
  background: #fef3c7; border-radius: 999px; padding: 3px 10px; white-space: nowrap; }
.an-stuck-row .am { font-size: 13.5px; font-weight: 800; min-width: 88px; text-align: right; }

/* Tendencia apilada (cotizado vs cobrado) */
.an-legend { display: flex; gap: 16px; margin: -6px 0 14px; font-size: 12px; font-weight: 700; color: #6b7280; }
.an-legend span { display: inline-flex; align-items: center; gap: 6px; }
.an-legend i { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }
.an-legend i.blue { background: linear-gradient(135deg, #4285f4, #1a73e8); }
.an-legend i.green { background: linear-gradient(135deg, #22c55e, #16a34a); }
.an-tchart { display: flex; align-items: flex-end; gap: 8px; height: 180px; padding-top: 22px; }
.an-tcol { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; height: 100%; justify-content: flex-end; min-width: 0; }
.an-tbar { width: 100%; max-width: 40px; border-radius: 7px 7px 0 0; min-height: 3px; position: relative;
  background: linear-gradient(180deg, #5a9bff, #1a73e8); transition: height .7s cubic-bezier(.2,.8,.3,1);
  display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden; }
.an-tbar .cob { width: 100%; background: linear-gradient(180deg, #22c55e, #16a34a); transition: height .7s cubic-bezier(.2,.8,.3,1); }
.an-tbar .cap { position: absolute; top: -19px; left: -8px; right: -8px; text-align: center;
  font-size: 10.5px; font-weight: 800; color: #1a56c4; white-space: nowrap; }
.an-tlbl { font-size: 11px; color: #9099a8; font-weight: 700; text-transform: capitalize; }

/* CFDI cuota */
.an-cfdi .row { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
.an-cfdi .big { font-size: 26px; font-weight: 850; letter-spacing: -0.02em; }
.an-cfdi .big small { font-size: 15px; font-weight: 700; color: #9099a8; }
.an-cfdi .plan { font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em;
  color: #1a56c4; background: #eef3ff; border-radius: 999px; padding: 4px 11px; }
.an-cfdi .track { height: 12px; background: #eef0f4; border-radius: 999px; overflow: hidden; margin: 6px 0 10px; }
.an-cfdi .track span { display: block; height: 100%; border-radius: 999px; transition: width .7s cubic-bezier(.2,.8,.3,1); }
.an-cfdi .track span.ok { background: linear-gradient(90deg, #16a34a, #22c55e); }
.an-cfdi .track span.warn { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
.an-cfdi .track span.full { background: linear-gradient(90deg, #dc2626, #ef4444); }
.an-cfdi .note { font-size: 12.5px; color: #6b7280; font-weight: 600; }
.an-cfdi .note b { color: #b45309; }

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

/* Distribución (productos / empresas / términos) con barra */
.an-dist { display: grid; gap: 12px; }
.an-drow .top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 6px; }
.an-drow .nm { font-size: 13.5px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-drow .vl { font-size: 13px; color: #6b7280; font-weight: 700; white-space: nowrap; }
.an-drow .vl b { color: #1a1a2e; }
.an-dbar { height: 10px; background: #eef0f4; border-radius: 999px; overflow: hidden; }
.an-dbar span { display: block; height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, #1a73e8, #4285f4); transition: width .7s cubic-bezier(.2,.8,.3,1); }
.an-dbar span.alt { background: linear-gradient(90deg, #7c3aed, #a855f7); }
.an-mini { text-align: center; color: #9099a8; padding: 18px 12px; font-size: 13px; font-weight: 600; }

.an-empty { text-align: center; color: #6b7280; padding: 30px 16px; border: 1px dashed #d8d8e0;
  border-radius: 14px; background: #fafafb; font-size: 14px; }

@media print {
  .an-noprint { display: none !important; }
  .an-hero { box-shadow: none; }
  .an-card, .an-kpi, .an-stuck { break-inside: avoid; }
}

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
  completedAt: string | null;
  cliente: string;
  empresa: string;
  terminos: string;
  monto: number;
  productos: { titulo: string; cantidad: number }[];
};

const DIA_MS = 86400000;

// Etiqueta de estado en español (para CSV).
const ESTADO_ES: Record<string, string> = {
  OPEN: "Abierta",
  INVOICE_SENT: "Enviada",
  COMPLETED: "Pagada",
};

// Variación relativa % vs periodo anterior. null cuando no es comparable.
function deltaPct(cur: number, prev: number): number | null {
  if (prev <= 0) return cur > 0 ? 100 : null;
  return ((cur - prev) / prev) * 100;
}

// Chip de variación vs periodo anterior. Para todas las métricas, subir = bueno.
function DeltaChip({ delta }: { delta: number | null | undefined }) {
  if (delta == null || !isFinite(delta)) return null;
  const r = Math.round(delta);
  if (r === 0) return <span className="an-delta flat">— sin cambio</span>;
  const up = r > 0;
  return (
    <span className={`an-delta ${up ? "up" : "down"}`}>
      {up ? "▲" : "▼"} {Math.abs(r)}% <span className="prev">vs anterior</span>
    </span>
  );
}

// Métricas núcleo de un conjunto de cotizaciones (para comparar periodos).
function nucleo(set: Quote[]) {
  const total = set.length;
  const pagadas = set.filter((q) => q.status === "COMPLETED");
  const ingresos = pagadas.reduce((s, q) => s + q.monto, 0);
  const pipeline = set
    .filter((q) => q.status === "OPEN" || q.status === "INVOICE_SENT")
    .reduce((s, q) => s + q.monto, 0);
  const conversion = total > 0 ? (pagadas.length / total) * 100 : 0;
  const ticket = total > 0 ? set.reduce((s, q) => s + q.monto, 0) / total : 0;
  return { total, ingresos, pipeline, conversion, ticket };
}

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
  // Compacto para captions de la gráfica ($1.2 M, $850 mil).
  const fmtCompact = useMemo(
    () =>
      new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency,
        notation: "compact",
        maximumFractionDigits: 1,
      }),
    [currency],
  );

  const diasRango = RANGOS.find((r) => r.id === rango)?.dias ?? null;

  // Ventana actual y ventana anterior (misma longitud) para las variaciones.
  const { filtrados, previo } = useMemo(() => {
    if (diasRango == null) return { filtrados: quotes, previo: null as Quote[] | null };
    const ahora = Date.now();
    const ini = ahora - diasRango * DIA_MS;
    const iniPrev = ahora - 2 * diasRango * DIA_MS;
    const cur: Quote[] = [];
    const prev: Quote[] = [];
    for (const q of quotes) {
      const t = new Date(q.createdAt).getTime();
      if (t >= ini) cur.push(q);
      else if (t >= iniPrev) prev.push(q);
    }
    return { filtrados: cur, previo: prev };
  }, [quotes, diasRango]);

  const m = useMemo(() => {
    const base = nucleo(filtrados);
    const prev = previo ? nucleo(previo) : null;
    const abiertas = filtrados.filter((q) => q.status === "OPEN");
    const enviadas = filtrados.filter((q) => q.status === "INVOICE_SENT");
    const pagadas = filtrados.filter((q) => q.status === "COMPLETED");

    // Variaciones vs periodo anterior (null si rango = "Todo").
    const deltas = prev
      ? {
          ingresos: deltaPct(base.ingresos, prev.ingresos),
          pipeline: deltaPct(base.pipeline, prev.pipeline),
          conversion: deltaPct(base.conversion, prev.conversion),
          total: deltaPct(base.total, prev.total),
          ticket: deltaPct(base.ticket, prev.ticket),
        }
      : null;

    // Tiempo promedio de cierre (días de creada → pagada).
    const cerradas = pagadas.filter((q) => q.completedAt);
    const tiempoCierre =
      cerradas.length > 0
        ? cerradas.reduce(
            (s, q) =>
              s +
              (new Date(q.completedAt!).getTime() - new Date(q.createdAt).getTime()) /
                DIA_MS,
            0,
          ) / cerradas.length
        : null;

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

    // Top productos cotizados (por cantidad pedida).
    const porProducto = new Map<string, { cantidad: number; n: number }>();
    for (const q of filtrados) {
      for (const p of q.productos) {
        const cur = porProducto.get(p.titulo) ?? { cantidad: 0, n: 0 };
        cur.cantidad += p.cantidad;
        cur.n += 1;
        porProducto.set(p.titulo, cur);
      }
    }
    const productos = [...porProducto.entries()]
      .map(([titulo, v]) => ({ titulo, ...v }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5);

    // Desglose por empresa B2B (pipeline + cobrado).
    const porEmpresa = new Map<string, { monto: number; n: number }>();
    for (const q of filtrados) {
      if (!q.empresa) continue;
      const cur = porEmpresa.get(q.empresa) ?? { monto: 0, n: 0 };
      cur.monto += q.monto;
      cur.n += 1;
      porEmpresa.set(q.empresa, cur);
    }
    const empresas = [...porEmpresa.entries()]
      .map(([nombre, v]) => ({ nombre, ...v }))
      .sort((a, b) => b.monto - a.monto)
      .slice(0, 5);

    // Desglose por término de crédito.
    const porTermino = new Map<string, { monto: number; n: number }>();
    for (const q of filtrados) {
      const k = q.terminos || "Sin término";
      const cur = porTermino.get(k) ?? { monto: 0, n: 0 };
      cur.monto += q.monto;
      cur.n += 1;
      porTermino.set(k, cur);
    }
    const terminos = [...porTermino.entries()]
      .map(([nombre, v]) => ({ nombre, ...v }))
      .sort((a, b) => b.monto - a.monto);

    // Tendencia adaptativa al rango: cotizado (azul) + cobrado (verde).
    const buckets: { label: string; ini: number; fin: number; cotizado: number; cobrado: number }[] = [];
    if (diasRango == null) {
      const d = new Date();
      for (let i = 5; i >= 0; i--) {
        const s = new Date(d.getFullYear(), d.getMonth() - i, 1);
        const e = new Date(d.getFullYear(), d.getMonth() - i + 1, 1);
        buckets.push({ label: MESES[s.getMonth()], ini: s.getTime(), fin: e.getTime(), cotizado: 0, cobrado: 0 });
      }
    } else {
      const cfg =
        diasRango <= 7 ? { n: 7, paso: 1 } : diasRango <= 30 ? { n: 10, paso: 3 } : { n: 13, paso: 7 };
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      const finBase = hoy.getTime() + DIA_MS;
      for (let i = cfg.n - 1; i >= 0; i--) {
        const fin = finBase - i * cfg.paso * DIA_MS;
        const ini = fin - cfg.paso * DIA_MS;
        buckets.push({ label: String(new Date(ini).getDate()), ini, fin, cotizado: 0, cobrado: 0 });
      }
    }
    for (const q of quotes) {
      const t = new Date(q.createdAt).getTime();
      for (const b of buckets) {
        if (t >= b.ini && t < b.fin) {
          b.cotizado += q.monto;
          if (q.status === "COMPLETED") b.cobrado += q.monto;
          break;
        }
      }
    }
    const maxBucket = Math.max(1, ...buckets.map((b) => b.cotizado));

    return {
      ...base,
      abiertas: abiertas.length,
      enviadas: enviadas.length,
      pagadas: pagadas.length,
      deltas,
      tiempoCierre,
      top,
      productos,
      empresas,
      terminos,
      buckets,
      maxBucket,
    };
  }, [filtrados, previo, quotes, diasRango]);

  // Cotizaciones estancadas: abiertas/enviadas con +7 días sin cerrarse.
  // Independiente del rango — es una lista de "pendientes por dar seguimiento".
  const estancadas = useMemo(() => {
    const ahora = Date.now();
    return quotes
      .filter((q) => q.status === "OPEN" || q.status === "INVOICE_SENT")
      .map((q) => ({
        ...q,
        dias: Math.floor((ahora - new Date(q.createdAt).getTime()) / DIA_MS),
      }))
      .filter((q) => q.dias >= 7)
      .sort((a, b) => b.dias - a.dias);
  }, [quotes]);

  const riesgo = useMemo(
    () => estancadas.reduce((s, q) => s + q.monto, 0),
    [estancadas],
  );

  // Insights automáticos (máx 3, priorizados).
  const insights = useMemo(() => {
    const out: { tone: string; ic: string; node: any }[] = [];
    const d = m.deltas;
    if (d?.ingresos != null && Math.abs(d.ingresos) >= 8) {
      const up = d.ingresos > 0;
      out.push({
        tone: up ? "good" : "warn",
        ic: up ? "📈" : "📉",
        node: (
          <span>
            Tus ingresos cobrados {up ? "subieron" : "bajaron"}{" "}
            <b>{Math.abs(d.ingresos).toFixed(0)}%</b> vs el periodo anterior.
          </span>
        ),
      });
    }
    if (estancadas.length > 0) {
      out.push({
        tone: "warn",
        ic: "⏰",
        node: (
          <span>
            Tienes <b>{estancadas.length}</b>{" "}
            {estancadas.length === 1 ? "cotización estancada" : "cotizaciones estancadas"} (+7 días)
            por <b>{fmtMoney.format(riesgo)}</b> — dales seguimiento.
          </span>
        ),
      });
    }
    const totalMonto = filtrados.reduce((s, q) => s + q.monto, 0);
    if (m.top.length > 0 && totalMonto > 0) {
      const share = (m.top[0].monto / totalMonto) * 100;
      if (share >= 35) {
        out.push({
          tone: "info",
          ic: "🎯",
          node: (
            <span>
              <b>{m.top[0].nombre}</b> concentra el <b>{share.toFixed(0)}%</b> del monto cotizado del periodo.
            </span>
          ),
        });
      }
    }
    if (data.cfdi && m.total > 0) {
      const pct = data.cfdi.limite > 0 ? (data.cfdi.timbrados / data.cfdi.limite) * 100 : 0;
      if (pct >= 80) {
        out.push({
          tone: pct >= 100 ? "warn" : "info",
          ic: "🧾",
          node: (
            <span>
              Vas en <b>{data.cfdi.timbrados}/{data.cfdi.limite}</b> facturas CFDI este mes
              {pct >= 100 ? " — ya estás cobrando excedente." : "."}
            </span>
          ),
        });
      }
    }
    if (d?.conversion != null && Math.abs(d.conversion) >= 10 && out.length < 3) {
      const up = d.conversion > 0;
      out.push({
        tone: up ? "good" : "info",
        ic: up ? "🎉" : "🔍",
        node: (
          <span>
            Tu conversión {up ? "mejoró" : "cayó"} <b>{Math.abs(d.conversion).toFixed(0)}%</b> respecto
            al periodo anterior.
          </span>
        ),
      });
    }
    return out.slice(0, 3);
  }, [m, estancadas, riesgo, filtrados, data.cfdi, fmtMoney]);

  const ingresosAnim = useCountUp(m.ingresos);
  const conversionAnim = useCountUp(m.conversion);
  const totalAnim = useCountUp(m.total);
  const pipelineAnim = useCountUp(m.pipeline);
  const ticketAnim = useCountUp(m.ticket);

  const maxFunnel = Math.max(1, m.abiertas, m.enviadas, m.pagadas);

  // Descarga las cotizaciones del periodo como CSV (para contabilidad / Excel).
  const exportarCSV = () => {
    const headers = ["Folio", "Cliente", "Empresa", "Estado", "Monto", "Creada", "Términos"];
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const filas = filtrados.map((q) =>
      [
        q.name,
        q.cliente,
        q.empresa || "",
        ESTADO_ES[q.status] ?? q.status,
        q.monto.toFixed(2),
        new Date(q.createdAt).toLocaleDateString("es-MX"),
        q.terminos || "",
      ]
        .map(esc)
        .join(","),
    );
    const csv = [headers.map(esc).join(","), ...filas].join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analitica-${rango}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
              <li><span className="chk">✓</span> Ingresos, pipeline y conversión con variación vs el periodo anterior</li>
              <li><span className="chk">✓</span> Cotizaciones estancadas por dar seguimiento</li>
              <li><span className="chk">✓</span> Tendencia de ingresos, embudo y tiempo de cierre</li>
              <li><span className="chk">✓</span> Top clientes y productos, desglose por empresa y exportar a CSV</li>
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

        {/* Insights automáticos */}
        {insights.length > 0 && (
          <div className="an-insights">
            {insights.map((it, i) => (
              <div className={`an-insight ${it.tone}`} key={i}>
                <span className="ic">{it.ic}</span>
                <span>{it.node}</span>
              </div>
            ))}
          </div>
        )}

        {/* Toolbar: rango + exportar */}
        <div className="an-toolbar an-noprint">
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
          <div className="an-export">
            <button onClick={exportarCSV} title="Descargar las cotizaciones del periodo">
              ⬇ CSV
            </button>
            <button onClick={() => window.print()} title="Imprimir o guardar como PDF">
              🖨 PDF
            </button>
          </div>
        </div>

        {/* Cotizaciones estancadas (siempre visible, independiente del rango) */}
        {quotes.length > 0 && (
          estancadas.length > 0 ? (
            <div className="an-stuck">
              <h3>⏰ Cotizaciones por dar seguimiento</h3>
              <p className="sub">
                {estancadas.length} {estancadas.length === 1 ? "cotización abierta" : "cotizaciones abiertas"} con
                +7 días sin cerrarse — <span className="risk">{fmtMoney.format(riesgo)} en riesgo</span>.
              </p>
              <div className="an-stuck-list">
                {estancadas.slice(0, 6).map((q) => (
                  <div
                    className="an-stuck-row"
                    key={q.id}
                    onClick={() => navigate(`/app/quotes/${q.id.split("/").pop()}`)}
                  >
                    <div>
                      <div className="nm">{q.name}</div>
                      <div className="cli">{q.cliente}</div>
                    </div>
                    <span className="age">{q.dias} días</span>
                    <span className="am">{fmtMoney.format(q.monto)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="an-stuck zero">
              <h3>✅ Sin cotizaciones estancadas</h3>
              <p className="sub" style={{ margin: 0 }}>
                Todas tus cotizaciones abiertas tienen menos de 7 días. ¡Buen seguimiento!
              </p>
            </div>
          )
        )}

        {/* KPIs */}
        <div className="an-kpis">
          <div className="an-kpi good">
            <div className="ic">💰</div>
            <div className="lbl">Ingresos cobrados</div>
            <div className="num">{fmtMoney.format(ingresosAnim)}</div>
            <DeltaChip delta={m.deltas?.ingresos} />
          </div>
          <div className="an-kpi accent">
            <div className="ic">⏳</div>
            <div className="lbl">Valor en pipeline</div>
            <div className="num">{fmtMoney.format(pipelineAnim)}</div>
            <DeltaChip delta={m.deltas?.pipeline} />
          </div>
          <div className="an-kpi">
            <div className="ic">🎯</div>
            <div className="lbl">Tasa de conversión</div>
            <div className="num">{conversionAnim.toFixed(1)}%</div>
            <DeltaChip delta={m.deltas?.conversion} />
          </div>
          <div className="an-kpi">
            <div className="ic">🧾</div>
            <div className="lbl">Cotizaciones</div>
            <div className="num">{Math.round(totalAnim)}</div>
            <DeltaChip delta={m.deltas?.total} />
          </div>
          <div className="an-kpi">
            <div className="ic">📦</div>
            <div className="lbl">Ticket promedio</div>
            <div className="num">{fmtMoney.format(ticketAnim)}</div>
            <DeltaChip delta={m.deltas?.ticket} />
          </div>
          <div className="an-kpi">
            <div className="ic">⚡</div>
            <div className="lbl">Tiempo de cierre</div>
            <div className="num">
              {m.tiempoCierre != null ? `${m.tiempoCierre.toFixed(1)} d` : "—"}
            </div>
          </div>
        </div>

        {m.total === 0 ? (
          <div className="an-empty">
            No hay cotizaciones en este rango. Prueba con un periodo más amplio o
            crea tu primera cotización.
          </div>
        ) : (
          <>
            {/* Tendencia de ingresos (adaptada al rango) */}
            <div className="an-section-title">Tendencia</div>
            <div className="an-card">
              <h3>📈 Monto cotizado vs cobrado</h3>
              <div className="an-legend">
                <span><i className="blue" /> Cotizado</span>
                <span><i className="green" /> Cobrado</span>
              </div>
              <div className="an-tchart">
                {m.buckets.map((b, i) => (
                  <div className="an-tcol" key={i}>
                    <div
                      className="an-tbar"
                      style={{ height: `${(b.cotizado / m.maxBucket) * 100}%` }}
                    >
                      {b.cotizado > 0 ? (
                        <span className="cap">{fmtCompact.format(b.cotizado)}</span>
                      ) : null}
                      <div
                        className="cob"
                        style={{
                          height: `${b.cotizado > 0 ? (b.cobrado / b.cotizado) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="an-tlbl">{b.label}</div>
                  </div>
                ))}
              </div>
            </div>

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

              {/* Top productos cotizados */}
              <div className="an-card">
                <h3>📦 Top productos cotizados</h3>
                {m.productos.length > 0 ? (
                  <div className="an-dist">
                    {m.productos.map((p) => (
                      <div className="an-drow" key={p.titulo}>
                        <div className="top">
                          <span className="nm">{p.titulo}</span>
                          <span className="vl">
                            <b>{p.cantidad}</b> uds · {p.n}
                          </span>
                        </div>
                        <div className="an-dbar">
                          <span
                            style={{
                              width: `${(p.cantidad / m.productos[0].cantidad) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="an-mini">Sin productos en este rango.</div>
                )}
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

            {/* Desglose B2B: empresas + términos de crédito */}
            <div className="an-section-title">Desglose B2B</div>
            <div className="an-cols">
              <div className="an-card">
                <h3>🏢 Por empresa</h3>
                {m.empresas.length > 0 ? (
                  <div className="an-dist">
                    {m.empresas.map((e) => (
                      <div className="an-drow" key={e.nombre}>
                        <div className="top">
                          <span className="nm">{e.nombre}</span>
                          <span className="vl"><b>{fmtMoney.format(e.monto)}</b> · {e.n}</span>
                        </div>
                        <div className="an-dbar">
                          <span
                            style={{ width: `${(e.monto / m.empresas[0].monto) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="an-mini">
                    Aún no asignas empresas a tus cotizaciones.
                  </div>
                )}
              </div>

              <div className="an-card">
                <h3>💳 Por término de crédito</h3>
                <div className="an-dist">
                  {m.terminos.map((t) => (
                    <div className="an-drow" key={t.nombre}>
                      <div className="top">
                        <span className="nm">{t.nombre}</span>
                        <span className="vl"><b>{fmtMoney.format(t.monto)}</b> · {t.n}</span>
                      </div>
                      <div className="an-dbar">
                        <span
                          className="alt"
                          style={{ width: `${(t.monto / m.terminos[0].monto) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Uso de CFDI del mes */}
            {data.cfdi && (
              <>
                <div className="an-section-title">Facturación CFDI</div>
                <div className="an-card an-cfdi">
                  <h3>🧾 Facturas timbradas este mes</h3>
                  <div className="row">
                    <span className="big">
                      {data.cfdi.timbrados}
                      <small> / {data.cfdi.limite}</small>
                    </span>
                    <span className="plan">Plan {data.cfdi.plan}</span>
                  </div>
                  {(() => {
                    const pct = data.cfdi.limite > 0
                      ? Math.min(100, (data.cfdi.timbrados / data.cfdi.limite) * 100)
                      : 0;
                    const cls = pct >= 100 ? "full" : pct >= 80 ? "warn" : "ok";
                    return (
                      <div className="track">
                        <span className={cls} style={{ width: `${pct}%` }} />
                      </div>
                    );
                  })()}
                  <div className="note">
                    {data.cfdi.timbrados === 0 ? (
                      "Aún no has timbrado facturas este mes."
                    ) : data.cfdi.extraCobrado > 0 ? (
                      <>
                        Cuota agotada. <b>{data.cfdi.extraCobrado} factura(s) de excedente</b> a $
                        {data.cfdi.extra.toFixed(2)} USD c/u.
                      </>
                    ) : (
                      `Te quedan ${Math.max(0, data.cfdi.limite - data.cfdi.timbrados)} facturas incluidas este mes.`
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
