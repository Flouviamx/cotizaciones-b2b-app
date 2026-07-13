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
import { Kpi } from "../components/Kpi";

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
      {!limite.paid ? (
        <s-badge slot="accessory" tone={limite.bloqueado ? "critical" : "info"}>
          {`${limite.activas} / ${limite.limite} activas`}
        </s-badge>
      ) : null}
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/quotes/new")}
      >
        Nueva cotización
      </s-button>

      {/* Aviso de límite del Plan Gratis */}
      {!limite.paid && limite.bloqueado ? (
        <s-banner
          tone="warning"
          heading={`Llegaste al límite del Plan Gratis (${limite.limite} cotizaciones activas)`}
        >
          <s-paragraph>
            Marca cotizaciones como pagadas para liberar espacio, o mejora tu
            plan para tener cotizaciones ilimitadas.
          </s-paragraph>
          <s-button
            slot="primary-action"
            variant="primary"
            onClick={() => navigate("/app/plans")}
          >
            Ver planes
          </s-button>
        </s-banner>
      ) : null}

      {/* Aviso de solicitudes de la tienda */}
      {pendientesTienda > 0 ? (
        <s-banner
          tone="info"
          heading={`Tienes ${pendientesTienda} solicitud(es) de la tienda pendientes de atender`}
        >
          <s-paragraph>
            Asígnales precio y envía el link de pago al cliente.
          </s-paragraph>
        </s-banner>
      ) : null}

      {/* Resumen */}
      <s-section accessibilityLabel="Resumen de cotizaciones">
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))"
          gap="base"
        >
          <Kpi label="Abiertas" value={`${abiertas}`} pie="por atender" />
          <Kpi label="Enviadas" value={`${enviadas}`} pie="esperando pago" />
          <Kpi label="Pagadas" value={`${pagadas}`} pie="ya son pedidos" />
          <Kpi
            label="Pendiente de cobro"
            value={formatoMoneda(valorPendiente, moneda)}
            pie="en cotizaciones activas"
          />
        </s-grid>
      </s-section>

      {/* Lista con filtros */}
      <s-section accessibilityLabel="Lista de cotizaciones" padding="none">
        <s-box padding="base">
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-select
              label="Estado"
              value={statusFilter}
              onChange={(e: any) => setStatusFilter(e.currentTarget.value)}
            >
              <s-option value="">Todas</s-option>
              <s-option value="OPEN">Abiertas</s-option>
              <s-option value="INVOICE_SENT">Enviadas</s-option>
              <s-option value="COMPLETED">Pagadas</s-option>
            </s-select>
            <s-search-field
              label="Buscar"
              placeholder="Cliente, solicitante o número…"
              value={search}
              onInput={(e: any) => setSearch(e.currentTarget.value)}
            />
            <s-text color="subdued">
              {filtradas.length} de {quotes.length}
            </s-text>
          </s-stack>
        </s-box>

        {quotes.length === 0 ? (
          <s-box padding="large-300">
            <s-stack gap="base" alignItems="center">
              <s-heading>Aún no tienes cotizaciones</s-heading>
              <s-paragraph color="subdued">
                Crea una cotización manual para tu cliente, o activa el botón en
                tu tienda para que ellos mismos la soliciten.
              </s-paragraph>
              <s-stack direction="inline" gap="small-200">
                <s-button
                  variant="primary"
                  onClick={() => navigate("/app/quotes/new")}
                >
                  Crear cotización
                </s-button>
                <s-button onClick={() => navigate("/app")}>
                  Ver primeros pasos
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        ) : filtradas.length === 0 ? (
          <s-box padding="large-300">
            <s-stack gap="small-200" alignItems="center">
              <s-heading>Sin resultados</s-heading>
              <s-paragraph color="subdued">
                Ninguna cotización coincide con el filtro o la búsqueda.
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Cotización</s-table-header>
              <s-table-header>Cliente</s-table-header>
              <s-table-header>Estado</s-table-header>
              <s-table-header>Total</s-table-header>
              <s-table-header>Fecha</s-table-header>
            </s-table-header-row>
            <s-table-body>
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
                const fecha = q.createdAt
                  ? new Date(q.createdAt).toLocaleDateString("es-MX")
                  : "";
                const numericId = q.id.split("/").pop();
                return (
                  <s-table-row key={q.id}>
                    <s-table-cell>
                      <s-link
                        onClick={() => navigate(`/app/quotes/${numericId}`)}
                      >
                        {q.name}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{nombre}</s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-300">
                        <s-badge tone={estadoTone(q.status)}>
                          {estadoLegible(q.status)}
                        </s-badge>
                        {desdeTienda ? (
                          <s-badge tone="info">Desde la tienda</s-badge>
                        ) : null}
                        {facturado ? (
                          <s-badge tone="success">Facturado</s-badge>
                        ) : null}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      {formatoMoneda(
                        q.totalPriceSet.shopMoney.amount,
                        q.totalPriceSet.shopMoney.currencyCode,
                      )}
                    </s-table-cell>
                    <s-table-cell>{fecha}</s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}

        {/* Botón de prueba (dev) */}
        <s-box padding="base">
          <s-button
            variant="tertiary"
            onClick={crearCotizacion}
            disabled={isLoading || limite.bloqueado}
            loading={isLoading}
          >
            {limite.bloqueado
              ? "Límite del Plan Gratis alcanzado"
              : "Crear cotización de ejemplo (para probar)"}
          </s-button>
        </s-box>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
