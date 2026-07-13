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
  if (r === 0) return <s-badge tone="neutral">— sin cambio</s-badge>;
  const up = r > 0;
  return (
    <s-badge tone={up ? "success" : "critical"}>
      {`${up ? "▲" : "▼"} ${Math.abs(r)}% vs anterior`}
    </s-badge>
  );
}

// Barra de progreso simple para gráficas (Polaris no trae charts; estilos
// inline mínimos solo para la visualización de datos).
const TRACK: React.CSSProperties = {
  height: 8,
  background: "#e6e6e8",
  borderRadius: 999,
  overflow: "hidden",
};
function Barra({ pct, color }: { pct: number; color?: string }) {
  return (
    <div style={TRACK}>
      <div
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          height: "100%",
          borderRadius: 999,
          background: color ?? "#2c6ecb",
        }}
      />
    </div>
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
        <s-section heading="Analítica es una función del Plan Pro">
          <s-stack gap="base">
            <s-stack direction="inline">
              <s-badge icon="lock" tone="info">Plan Pro</s-badge>
            </s-stack>
            <s-paragraph color="subdued">
              Mide el pulso de tu negocio B2B: ingresos cobrados, valor en
              pipeline, conversión de cotizaciones a ventas y tus mejores
              clientes — todo en un panel claro.
            </s-paragraph>
            <s-unordered-list>
              <s-list-item>
                Ingresos, pipeline y conversión con variación vs el periodo
                anterior
              </s-list-item>
              <s-list-item>
                Cotizaciones estancadas por dar seguimiento
              </s-list-item>
              <s-list-item>
                Tendencia de ingresos, embudo y tiempo de cierre
              </s-list-item>
              <s-list-item>
                Top clientes y productos, desglose por empresa y exportar a CSV
              </s-list-item>
            </s-unordered-list>
            <s-stack direction="inline">
              <s-button variant="primary" onClick={() => navigate("/app/plans")}>
                Subir al Plan Pro
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const TONO_INSIGHT: Record<string, "success" | "warning" | "info"> = {
    good: "success",
    warn: "warning",
    info: "info",
  };

  return (
    <s-page heading="Analítica">
      <s-button slot="breadcrumbs" variant="tertiary" href="/app" icon="arrow-left">
        Inicio
      </s-button>

      {/* Insights automáticos */}
      {insights.map((it, i) => (
        <s-banner key={i} tone={TONO_INSIGHT[it.tone] ?? "info"}>
          <s-paragraph>{it.node}</s-paragraph>
        </s-banner>
      ))}

      {/* Rango + exportar + KPIs */}
      <s-section accessibilityLabel="Indicadores del periodo">
        <s-stack gap="base">
          <s-stack
            direction="inline"
            gap="small-200"
            justifyContent="space-between"
            alignItems="center"
          >
            <s-stack direction="inline" gap="small-300">
              {RANGOS.map((r) => (
                <s-button
                  key={r.id}
                  variant={rango === r.id ? "primary" : "secondary"}
                  onClick={() => setRango(r.id)}
                >
                  {r.label}
                </s-button>
              ))}
            </s-stack>
            <s-stack direction="inline" gap="small-300">
              <s-button variant="tertiary" onClick={exportarCSV}>
                Exportar CSV
              </s-button>
              <s-button variant="tertiary" onClick={() => window.print()}>
                Imprimir / PDF
              </s-button>
            </s-stack>
          </s-stack>

          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
            gap="base"
          >
            <s-stack gap="small-300">
              <s-text color="subdued">Ingresos cobrados</s-text>
              <s-heading>{fmtMoney.format(ingresosAnim)}</s-heading>
              <s-stack direction="inline">
                <DeltaChip delta={m.deltas?.ingresos} />
              </s-stack>
            </s-stack>
            <s-stack gap="small-300">
              <s-text color="subdued">Valor en pipeline</s-text>
              <s-heading>{fmtMoney.format(pipelineAnim)}</s-heading>
              <s-stack direction="inline">
                <DeltaChip delta={m.deltas?.pipeline} />
              </s-stack>
            </s-stack>
            <s-stack gap="small-300">
              <s-text color="subdued">Tasa de conversión</s-text>
              <s-heading>{`${conversionAnim.toFixed(1)}%`}</s-heading>
              <s-stack direction="inline">
                <DeltaChip delta={m.deltas?.conversion} />
              </s-stack>
            </s-stack>
            <s-stack gap="small-300">
              <s-text color="subdued">Cotizaciones</s-text>
              <s-heading>{`${Math.round(totalAnim)}`}</s-heading>
              <s-stack direction="inline">
                <DeltaChip delta={m.deltas?.total} />
              </s-stack>
            </s-stack>
            <s-stack gap="small-300">
              <s-text color="subdued">Ticket promedio</s-text>
              <s-heading>{fmtMoney.format(ticketAnim)}</s-heading>
              <s-stack direction="inline">
                <DeltaChip delta={m.deltas?.ticket} />
              </s-stack>
            </s-stack>
            <s-stack gap="small-300">
              <s-text color="subdued">Tiempo de cierre</s-text>
              <s-heading>
                {m.tiempoCierre != null ? `${m.tiempoCierre.toFixed(1)} d` : "—"}
              </s-heading>
            </s-stack>
          </s-grid>
        </s-stack>
      </s-section>

      {/* Cotizaciones estancadas (siempre visible, independiente del rango) */}
      {quotes.length > 0 ? (
        <s-section heading="Cotizaciones por dar seguimiento">
          {estancadas.length > 0 ? (
            <s-stack gap="base">
              <s-paragraph color="subdued">
                {estancadas.length}{" "}
                {estancadas.length === 1
                  ? "cotización abierta"
                  : "cotizaciones abiertas"}{" "}
                con +7 días sin cerrarse — {fmtMoney.format(riesgo)} en riesgo.
              </s-paragraph>
              <s-stack gap="small-200">
                {estancadas.slice(0, 6).map((q, idx) => (
                  <s-stack gap="small-200" key={q.id}>
                    {idx > 0 ? <s-divider /> : null}
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <s-link
                          onClick={() =>
                            navigate(`/app/quotes/${q.id.split("/").pop()}`)
                          }
                        >
                          {q.name}
                        </s-link>
                        <s-text color="subdued">{q.cliente}</s-text>
                        <s-badge tone="caution">{`${q.dias} días`}</s-badge>
                      </s-stack>
                      <s-text fontVariantNumeric="tabular-nums">
                        {fmtMoney.format(q.monto)}
                      </s-text>
                    </s-stack>
                  </s-stack>
                ))}
              </s-stack>
            </s-stack>
          ) : (
            <s-banner tone="success" heading="Sin cotizaciones estancadas">
              <s-paragraph>
                Todas tus cotizaciones abiertas tienen menos de 7 días. ¡Buen
                seguimiento!
              </s-paragraph>
            </s-banner>
          )}
        </s-section>
      ) : null}

      {m.total === 0 ? (
        <s-section accessibilityLabel="Sin datos">
          <s-paragraph color="subdued">
            No hay cotizaciones en este rango. Prueba con un periodo más amplio
            o crea tu primera cotización.
          </s-paragraph>
        </s-section>
      ) : (
        <>
          {/* Tendencia de ingresos (adaptada al rango) */}
          <s-section heading="Monto cotizado vs cobrado">
            <s-stack gap="base">
              <s-stack direction="inline" gap="base">
                <s-text color="subdued">🟦 Cotizado</s-text>
                <s-text color="subdued">🟩 Cobrado</s-text>
              </s-stack>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 8,
                  height: 180,
                  paddingTop: 22,
                }}
              >
                {m.buckets.map((b, i) => (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 8,
                      height: "100%",
                      justifyContent: "flex-end",
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        maxWidth: 40,
                        borderRadius: "7px 7px 0 0",
                        minHeight: 3,
                        position: "relative",
                        background: "#2c6ecb",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "flex-end",
                        overflow: "hidden",
                        height: `${(b.cotizado / m.maxBucket) * 100}%`,
                      }}
                    >
                      {b.cotizado > 0 ? (
                        <span
                          style={{
                            position: "absolute",
                            top: -19,
                            left: -8,
                            right: -8,
                            textAlign: "center",
                            fontSize: 10.5,
                            fontWeight: 700,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {fmtCompact.format(b.cotizado)}
                        </span>
                      ) : null}
                      <div
                        style={{
                          width: "100%",
                          background: "#29845a",
                          height: `${b.cotizado > 0 ? (b.cobrado / b.cotizado) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 11, textTransform: "capitalize" }}>
                      {b.label}
                    </span>
                  </div>
                ))}
              </div>
            </s-stack>
          </s-section>

          {/* Embudo + top productos */}
          <s-section heading="Embudo de cotizaciones">
            <s-stack gap="base">
              <s-stack gap="small-300">
                <s-stack direction="inline" justifyContent="space-between">
                  <s-text>Abiertas</s-text>
                  <s-text color="subdued">{`${m.abiertas}`}</s-text>
                </s-stack>
                <Barra pct={(m.abiertas / maxFunnel) * 100} />
              </s-stack>
              <s-stack gap="small-300">
                <s-stack direction="inline" justifyContent="space-between">
                  <s-text>Enviadas (link de pago)</s-text>
                  <s-text color="subdued">{`${m.enviadas}`}</s-text>
                </s-stack>
                <Barra pct={(m.enviadas / maxFunnel) * 100} color="#b28400" />
              </s-stack>
              <s-stack gap="small-300">
                <s-stack direction="inline" justifyContent="space-between">
                  <s-text>Pagadas</s-text>
                  <s-text color="subdued">{`${m.pagadas}`}</s-text>
                </s-stack>
                <Barra pct={(m.pagadas / maxFunnel) * 100} color="#29845a" />
              </s-stack>
            </s-stack>
          </s-section>

          <s-section heading="Top productos cotizados">
            {m.productos.length > 0 ? (
              <s-stack gap="base">
                {m.productos.map((p) => (
                  <s-stack gap="small-300" key={p.titulo}>
                    <s-stack direction="inline" justifyContent="space-between" gap="small-200">
                      <s-text>{p.titulo}</s-text>
                      <s-text color="subdued">{`${p.cantidad} uds · ${p.n}`}</s-text>
                    </s-stack>
                    <Barra pct={(p.cantidad / m.productos[0].cantidad) * 100} />
                  </s-stack>
                ))}
              </s-stack>
            ) : (
              <s-paragraph color="subdued">
                Sin productos en este rango.
              </s-paragraph>
            )}
          </s-section>

          {/* Top clientes */}
          <s-section heading="Top 5 clientes por monto cotizado">
            <s-stack gap="small-200">
              {m.top.map((c, i) => (
                <s-stack gap="small-200" key={c.nombre}>
                  {i > 0 ? <s-divider /> : null}
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-badge tone={i === 0 ? "caution" : "neutral"}>
                        {`${i + 1}`}
                      </s-badge>
                      <s-text>{c.nombre}</s-text>
                      <s-text color="subdued">
                        {`${c.n} ${c.n === 1 ? "cotización" : "cotizaciones"}`}
                      </s-text>
                    </s-stack>
                    <s-text fontVariantNumeric="tabular-nums">
                      {fmtMoney.format(c.monto)}
                    </s-text>
                  </s-stack>
                </s-stack>
              ))}
            </s-stack>
          </s-section>

          {/* Desglose B2B: empresas + términos de crédito */}
          <s-section heading="Desglose por empresa B2B">
            {m.empresas.length > 0 ? (
              <s-stack gap="base">
                {m.empresas.map((e) => (
                  <s-stack gap="small-300" key={e.nombre}>
                    <s-stack direction="inline" justifyContent="space-between" gap="small-200">
                      <s-text>{e.nombre}</s-text>
                      <s-text color="subdued">
                        {`${fmtMoney.format(e.monto)} · ${e.n}`}
                      </s-text>
                    </s-stack>
                    <Barra pct={(e.monto / m.empresas[0].monto) * 100} />
                  </s-stack>
                ))}
              </s-stack>
            ) : (
              <s-paragraph color="subdued">
                Aún no asignas empresas a tus cotizaciones.
              </s-paragraph>
            )}
          </s-section>

          <s-section heading="Desglose por término de crédito">
            <s-stack gap="base">
              {m.terminos.map((t) => (
                <s-stack gap="small-300" key={t.nombre}>
                  <s-stack direction="inline" justifyContent="space-between" gap="small-200">
                    <s-text>{t.nombre}</s-text>
                    <s-text color="subdued">
                      {`${fmtMoney.format(t.monto)} · ${t.n}`}
                    </s-text>
                  </s-stack>
                  <Barra pct={(t.monto / m.terminos[0].monto) * 100} color="#8051ff" />
                </s-stack>
              ))}
            </s-stack>
          </s-section>

          {/* Uso de CFDI del mes */}
          {data.cfdi ? (
            <s-section heading="Facturas CFDI timbradas este mes">
              <s-stack gap="base">
                <s-stack
                  direction="inline"
                  gap="small-200"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-heading>{`${data.cfdi.timbrados} / ${data.cfdi.limite}`}</s-heading>
                  <s-badge tone="info">{`Plan ${data.cfdi.plan}`}</s-badge>
                </s-stack>
                {(() => {
                  const pct =
                    data.cfdi.limite > 0
                      ? Math.min(100, (data.cfdi.timbrados / data.cfdi.limite) * 100)
                      : 0;
                  const color =
                    pct >= 100 ? "#c5280c" : pct >= 80 ? "#b28400" : "#29845a";
                  return <Barra pct={pct} color={color} />;
                })()}
                <s-text color="subdued">
                  {data.cfdi.timbrados === 0
                    ? "Aún no has timbrado facturas este mes."
                    : data.cfdi.extraCobrado > 0
                      ? `Cuota agotada. ${data.cfdi.extraCobrado} factura(s) de excedente a $${data.cfdi.extra.toFixed(2)} USD c/u.`
                      : `Te quedan ${Math.max(0, data.cfdi.limite - data.cfdi.timbrados)} facturas incluidas este mes.`}
                </s-text>
              </s-stack>
            </s-section>
          ) : null}
        </>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
