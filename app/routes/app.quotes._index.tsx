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
import { evaluarLimite } from "../limites.server";

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
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query getQuotes {
        draftOrders(first: 50, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              status
              createdAt
              invoiceUrl
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
  const limite = await evaluarLimite(admin);
  return { quotes, limite };
};

// Crea una cotización de ejemplo (para probar rápido).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Tope del Plan Gratis (también aplica al botón de ejemplo).
  const limite = await evaluarLimite(admin);
  if (limite.bloqueado) {
    return {
      error: `Llegaste al límite de ${limite.limite} cotizaciones activas del Plan Gratis. Mejora tu plan para crear más.`,
    };
  }

  const productResp = await admin.graphql(
    `#graphql
      query firstVariant {
        products(first: 1) {
          edges { node { variants(first: 1) { edges { node { id } } } } }
        }
      }`,
  );
  const productJson: any = await productResp.json();
  const variantId =
    productJson.data?.products?.edges?.[0]?.node?.variants?.edges?.[0]?.node?.id;

  if (!variantId) {
    return {
      error:
        "Tu tienda no tiene productos todavía. Crea un producto en el admin y vuelve a intentar.",
    };
  }

  const response = await admin.graphql(
    `#graphql
      mutation createQuote($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { id name }
          userErrors { field message }
        }
      }`,
    { variables: { input: { lineItems: [{ variantId, quantity: 1 }] } } },
  );

  const json: any = await response.json();
  const userErrors = json.data?.draftOrderCreate?.userErrors ?? [];
  if (userErrors.length > 0) {
    return { error: userErrors.map((e: any) => e.message).join(", ") };
  }
  return { created: json.data?.draftOrderCreate?.draftOrder };
};

const CSS = `
.dq-wrap { max-width: 1040px; margin: 0 auto; padding: 8px 16px 40px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; color: #1a1a2e; }
/* 3 cards de conteo (chicas) + "Pendiente de cobro" (accent) al doble de ancho */
.dq-stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin: 8px 0 22px; }
.dq-stat { background: #fff; border: 1px solid #ececf0; border-radius: 14px; padding: 14px 16px; }
.dq-stat .lbl { font-size: 12.5px; color: #6b7280; font-weight: 600; }
.dq-stat .num { font-size: 23px; font-weight: 800; letter-spacing: -0.02em; margin-top: 4px; }
.dq-stat.accent { grid-column: span 2; border-color: #cfe0fc;
  background: linear-gradient(135deg, #f5f9ff, #eef5ff); padding: 16px 20px; }
.dq-stat.accent .lbl { font-size: 13px; }
.dq-stat.accent .num { color: #1a56c4; }
/* Monto: escala con el ancho de la card para que cifras grandes no se desborden */
.dq-stat .num.money { font-size: clamp(20px, 2.6vw, 29px); line-height: 1.15;
  display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
  font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.dq-stat .num.money .cur { font-size: 12px; font-weight: 700; color: #6b7280;
  letter-spacing: 0; }

.dq-banner { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; border-radius: 14px;
  padding: 14px 16px; margin-bottom: 18px; font-size: 14px; }
.dq-banner b { display: block; margin-bottom: 2px; }
.dq-banner a { text-decoration: underline; }
.dq-usage { font-size: 13px; font-weight: 600; color: #6b7280; margin-bottom: 16px;
  background: #f5f9ff; border: 1px solid #cfe0fc; border-radius: 10px; padding: 8px 12px; }
.dq-usage a { text-decoration: none; }
.dq-usage a:hover { text-decoration: underline; }

.dq-bar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; align-items: center; }
.dq-bar select, .dq-bar input { padding: 10px 12px; border: 1px solid #d8d8e0; border-radius: 10px;
  font-size: 14px; background: #fff; color: #1a1a2e; outline: none; }
.dq-bar select:focus, .dq-bar input:focus { border-color: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,.15); }
.dq-bar input { flex: 1; min-width: 200px; }
.dq-count { color: #6b7280; font-size: 13px; font-weight: 600; }

.dq-list { display: grid; gap: 12px; }
.dq-quote { background: #fff; border: 1px solid #ececf0; border-radius: 14px; padding: 16px 18px;
  transition: box-shadow .15s ease, transform .15s ease; }
.dq-quote:hover { box-shadow: 0 6px 20px -8px rgba(0,0,0,.15); transform: translateY(-1px); }
.dq-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dq-title { font-size: 15px; font-weight: 700; margin-right: 4px; }
.dq-meta { color: #6b7280; font-size: 13px; margin-top: 6px; }
.dq-badge { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; }
.dq-badge.open { background: #e8f0fe; color: #1a56c4; }
.dq-badge.sent { background: #fef3c7; color: #92400e; }
.dq-badge.paid { background: #dcfce7; color: #15803d; }
.dq-badge.store { background: #f3e8ff; color: #6b21a8; }
.dq-badge.inv { background: #dcfce7; color: #15803d; }
.dq-detail { margin-top: 12px; background: transparent; border: 0; color: #1a73e8;
  font-weight: 700; font-size: 14px; cursor: pointer; padding: 0; }
.dq-detail:hover { text-decoration: underline; }

.dq-empty { text-align: center; color: #6b7280; padding: 44px 20px; border: 1px dashed #d8d8e0;
  border-radius: 14px; background: #fafafb; }
.dq-example { margin-top: 20px; text-align: center; }
.dq-example button { background: transparent; border: 1px solid #d8d8e0; border-radius: 10px;
  padding: 8px 14px; font-size: 13px; color: #6b7280; cursor: pointer; }
.dq-example button:hover { border-color: #b8b8c4; }

@media (max-width: 600px) {
  .dq-stats { grid-template-columns: repeat(2, 1fr); }
  .dq-stat.accent { grid-column: span 2; }
}
`;

export default function Index() {
  const { quotes, limite } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const moneda = quotes[0]?.totalPriceSet.shopMoney.currencyCode ?? "";

  const abiertas = quotes.filter((q: any) => q.status === "OPEN").length;
  const enviadas = quotes.filter(
    (q: any) => q.status === "INVOICE_SENT",
  ).length;
  const pagadas = quotes.filter((q: any) => q.status === "COMPLETED").length;
  const valorPendiente = quotes
    .filter((q: any) => q.status !== "COMPLETED")
    .reduce(
      (sum: number, q: any) =>
        sum + parseFloat(q.totalPriceSet.shopMoney.amount || "0"),
      0,
    );

  const pendientesTienda = quotes.filter(
    (q: any) =>
      q.status === "OPEN" &&
      (q.customAttributes ?? []).some((a: any) => a.key === "Origen"),
  ).length;

  const filtradas = quotes.filter((q: any) => {
    const matchStatus = !statusFilter || q.status === statusFilter;
    const solicitante =
      (q.customAttributes ?? []).find((a: any) => a.key === "Solicitante")
        ?.value ?? "";
    const texto =
      `${q.name} ${q.customer?.displayName ?? ""} ${solicitante}`.toLowerCase();
    const matchSearch = !search || texto.includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.created?.name) {
      shopify.toast.show(`Cotización ${fetcher.data.created.name} creada`);
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const crearCotizacion = () => fetcher.submit({}, { method: "POST" });

  return (
    <s-page heading="Cotizaciones">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/quotes/new")}
      >
        Nueva cotización
      </s-button>

      <style>{CSS}</style>

      <div className="dq-wrap">
        {/* Resumen */}
        <div className="dq-stats">
          <div className="dq-stat">
            <div className="lbl">Abiertas</div>
            <div className="num">{abiertas}</div>
          </div>
          <div className="dq-stat">
            <div className="lbl">Enviadas</div>
            <div className="num">{enviadas}</div>
          </div>
          <div className="dq-stat">
            <div className="lbl">Pagadas</div>
            <div className="num">{pagadas}</div>
          </div>
          <div className="dq-stat accent">
            <div className="lbl">Pendiente de cobro</div>
            <div className="num money">
              {formatoMoneda(valorPendiente, moneda)}
              {moneda ? <span className="cur">{moneda}</span> : null}
            </div>
          </div>
        </div>

        {/* Plan Gratis: uso y aviso de límite */}
        {!limite.paid ? (
          limite.bloqueado ? (
            <div className="dq-banner">
              <b>
                Llegaste al límite del Plan Gratis ({limite.limite} cotizaciones
                activas)
              </b>
              Marca cotizaciones como pagadas para liberar espacio, o{" "}
              <a href="/app/plans" style={{ color: "#9a3412", fontWeight: 700 }}>
                mejora tu plan
              </a>{" "}
              para cotizaciones ilimitadas.
            </div>
          ) : (
            <div className="dq-usage">
              Plan Gratis · {limite.activas} de {limite.limite} cotizaciones
              activas ·{" "}
              <a href="/app/plans" style={{ color: "#1a56c4", fontWeight: 700 }}>
                Mejorar plan
              </a>
            </div>
          )
        ) : null}

        {/* Aviso de solicitudes de la tienda */}
        {pendientesTienda > 0 ? (
          <div className="dq-banner">
            <b>
              Tienes {pendientesTienda} solicitud(es) de la tienda pendientes
              de atender
            </b>
            Asígnales precio y envía el link de pago al cliente.
          </div>
        ) : null}

        {/* Filtros */}
        <div className="dq-bar">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Todas</option>
            <option value="OPEN">Abiertas</option>
            <option value="INVOICE_SENT">Enviadas</option>
            <option value="COMPLETED">Pagadas</option>
          </select>
          <input
            type="text"
            placeholder="Buscar por cliente, solicitante o número…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="dq-count">
            {filtradas.length} de {quotes.length}
          </span>
        </div>

        {/* Lista */}
        {quotes.length === 0 ? (
          <div className="dq-empty">
            Aún no tienes cotizaciones. Crea una con "Nueva cotización".
          </div>
        ) : filtradas.length === 0 ? (
          <div className="dq-empty">
            No hay cotizaciones que coincidan con el filtro o la búsqueda.
          </div>
        ) : (
          <div className="dq-list">
            {filtradas.map((q: any) => {
              const solicitante = (q.customAttributes ?? []).find(
                (a: any) => a.key === "Solicitante",
              )?.value;
              const nombre =
                q.customer?.displayName ?? solicitante ?? "Sin cliente";
              const desdeTienda = (q.customAttributes ?? []).some(
                (a: any) => a.key === "Origen",
              );
              const facturado = (q.customAttributes ?? []).some(
                (a: any) => a.key === "CFDI UUID" && a.value,
              );
              const terminos = (q.customAttributes ?? []).find(
                (a: any) => a.key === "Términos de crédito",
              )?.value;
              const fecha = q.createdAt
                ? new Date(q.createdAt).toLocaleDateString("es-MX")
                : "";
              const numericId = q.id.split("/").pop();
              return (
                <div className="dq-quote" key={q.id}>
                  <div className="dq-top">
                    <span className="dq-title">{q.name}</span>
                    <span>— {nombre}</span>
                    <span className={`dq-badge ${estadoClase(q.status)}`}>
                      {estadoLegible(q.status)}
                    </span>
                    {desdeTienda ? (
                      <span className="dq-badge store">Desde la tienda</span>
                    ) : null}
                    {facturado ? (
                      <span className="dq-badge inv">Facturado</span>
                    ) : null}
                  </div>
                  <div className="dq-meta">
                    Total:{" "}
                    {formatoMoneda(
                      q.totalPriceSet.shopMoney.amount,
                      q.totalPriceSet.shopMoney.currencyCode,
                    )}{" "}
                    {q.totalPriceSet.shopMoney.currencyCode}
                    {terminos ? `  ·  ${terminos}` : ""}
                    {fecha ? `  ·  ${fecha}` : ""}
                  </div>
                  <button
                    className="dq-detail"
                    onClick={() => navigate(`/app/quotes/${numericId}`)}
                  >
                    Ver detalle →
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Botón de prueba (dev) */}
        <div className="dq-example">
          <button
            onClick={crearCotizacion}
            disabled={isLoading || limite.bloqueado}
          >
            {isLoading
              ? "Creando…"
              : limite.bloqueado
                ? "Límite del Plan Gratis alcanzado"
                : "Crear cotización de ejemplo (para probar)"}
          </button>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
