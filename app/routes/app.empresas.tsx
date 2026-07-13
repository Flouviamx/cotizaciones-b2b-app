import { useEffect, useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { PLANES_PRO } from "../plans";
import { BILLING_TEST } from "../billing.server";

// El límite de crédito por empresa se guarda como metafield propio de la app
// sobre la empresa (no requiere scope write_metafields).
const NS = "$app:flouvia";
const KEY_LIMITE = "credito_limite";

// Topes de paginación (guardas para tiendas Plus de alto volumen).
const MAX_PAG_EMPRESAS = 20; // 20 × 50 = 1000 empresas
const MAX_PAG_DRAFTS = 24; //   24 × 250 = 6000 cotizaciones activas

function ajusteCatalogo(parent: any): string {
  const adj = parent?.adjustment;
  if (!adj || adj.value == null) return "";
  const signo = adj.type === "PERCENTAGE_DECREASE" ? "−" : "+";
  // value llega como "10.0" → mostramos sin decimales innecesarios.
  const v = parseFloat(String(adj.value));
  return `${signo}${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing } = await authenticate.admin(request);

  const proCheck = await billing.check({ plans: PLANES_PRO as any, isTest: BILLING_TEST });
  const hasPro = proCheck.hasActivePayment;

  // La función "Empresas B2B" es del Plan Pro. Sin Pro mostramos el teaser.
  if (!hasPro) {
    return { hasPro: false, empresas: [], currency: "MXN", truncado: false };
  }

  // 1) Empresas con su límite de crédito (metafield), contacto, ubicaciones y
  //    catálogos (lista de precios) por ubicación. Paginamos TODO (sin tope de 50).
  let currency = "MXN";
  const companies: any[] = [];
  let cursorComp: string | null = null;
  let truncadoEmpresas = false;
  for (let pag = 0; pag < MAX_PAG_EMPRESAS; pag++) {
    const compResp: any = await admin.graphql(
      `#graphql
        query empresasB2B($cursor: String) {
          shop { currencyCode }
          companies(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                name
                ordersCount { count }
                totalSpent { amount }
                contactCount
                locationsCount { count }
                mainContact { customer { displayName email } }
                locations(first: 5) {
                  edges {
                    node {
                      id
                      name
                      shippingAddress { city province country }
                      buyerExperienceConfiguration {
                        paymentTermsTemplate { name }
                      }
                      catalogs(first: 3) {
                        edges {
                          node {
                            title
                            status
                            priceList {
                              name
                              parent { adjustment { type value } }
                            }
                          }
                        }
                      }
                    }
                  }
                }
                metafield(namespace: "${NS}", key: "${KEY_LIMITE}") { value }
              }
            }
          }
        }`,
      { variables: { cursor: cursorComp } },
    );
    const compJson: any = await compResp.json();
    currency = compJson.data?.shop?.currencyCode ?? currency;
    const conn = compJson.data?.companies;
    for (const e of conn?.edges ?? []) companies.push(e.node);
    if (conn?.pageInfo?.hasNextPage) {
      cursorComp = conn.pageInfo.endCursor;
      if (pag === MAX_PAG_EMPRESAS - 1) truncadoEmpresas = true;
    } else {
      break;
    }
  }

  // 2) Cotizaciones ACTIVAS (Draft Orders OPEN + INVOICE_SENT) para el crédito EN
  //    USO por empresa. Filtramos por estado → solo las activas (acotado por
  //    naturaleza) y paginamos TODO, así el saldo es correcto a cualquier escala.
  //    Moneda: shopMoney (moneda base de la tienda), igual que el límite.
  const usoPorEmpresa = new Map<string, { usado: number; activas: number }>();
  let cursorDO: string | null = null;
  let truncadoDrafts = false;
  for (let pag = 0; pag < MAX_PAG_DRAFTS; pag++) {
    const doResp: any = await admin.graphql(
      `#graphql
        query draftActivosPorEmpresa($cursor: String) {
          draftOrders(first: 250, after: $cursor, query: "status:OPEN OR status:INVOICE_SENT") {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                totalPriceSet { shopMoney { amount } }
                purchasingEntity {
                  __typename
                  ... on PurchasingCompany { company { id } }
                }
              }
            }
          }
        }`,
      { variables: { cursor: cursorDO } },
    );
    const doJson: any = await doResp.json();
    const conn = doJson.data?.draftOrders;
    for (const e of conn?.edges ?? []) {
      const n = e.node;
      const compId = n.purchasingEntity?.company?.id;
      if (!compId) continue;
      const cur = usoPorEmpresa.get(compId) ?? { usado: 0, activas: 0 };
      cur.activas += 1;
      cur.usado += parseFloat(n.totalPriceSet?.shopMoney?.amount ?? "0");
      usoPorEmpresa.set(compId, cur);
    }
    if (conn?.pageInfo?.hasNextPage) {
      cursorDO = conn.pageInfo.endCursor;
      if (pag === MAX_PAG_DRAFTS - 1) truncadoDrafts = true;
    } else {
      break;
    }
  }

  const empresas = companies.map((c: any) => {
    const uso = usoPorEmpresa.get(c.id) ?? { usado: 0, activas: 0 };
    const limite = c.metafield?.value ? parseFloat(c.metafield.value) : 0;

    const ubicaciones = (c.locations?.edges ?? []).map((le: any) => {
      const ln = le.node;
      const dir = [ln.shippingAddress?.city, ln.shippingAddress?.province]
        .filter(Boolean)
        .join(", ");
      const catalogos = (ln.catalogs?.edges ?? []).map((ce: any) => ({
        title: ce.node.title,
        activo: ce.node.status === "ACTIVE",
        lista: ce.node.priceList?.name ?? "",
        ajuste: ajusteCatalogo(ce.node.priceList?.parent),
      }));
      return {
        id: ln.id,
        name: ln.name,
        dir,
        term: ln.buyerExperienceConfiguration?.paymentTermsTemplate?.name ?? "",
        catalogos,
      };
    });

    // Término para el badge de la tarjeta: si todas las ubicaciones comparten
    // término lo mostramos; si hay varios distintos, "Varios".
    const termSet = new Set<string>(
      ubicaciones.map((u: any) => u.term).filter(Boolean),
    );
    const terminos =
      termSet.size > 1 ? "Varios" : (termSet.values().next().value ?? "");

    return {
      id: c.id,
      name: c.name,
      limite,
      usado: uso.usado,
      activas: uso.activas,
      totalComprado: parseFloat(c.totalSpent?.amount ?? "0"),
      ordenes: c.ordersCount?.count ?? 0,
      contactos: c.contactCount ?? 0,
      contactoNombre: c.mainContact?.customer?.displayName ?? "",
      contactoEmail: c.mainContact?.customer?.email ?? "",
      ubicacionesCount: c.locationsCount?.count ?? ubicaciones.length,
      ubicaciones,
      terminos,
    };
  });

  return {
    hasPro: true,
    empresas,
    currency,
    truncado: truncadoEmpresas || truncadoDrafts,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const companyId = String(formData.get("companyId") ?? "");
  const limiteRaw = String(formData.get("limite") ?? "0").replace(/[^0-9.]/g, "");
  const limite = parseFloat(limiteRaw || "0");

  if (!companyId) return { error: "Empresa no válida." };
  if (isNaN(limite) || limite < 0) return { error: "Ingresa un límite válido." };

  const resp = await admin.graphql(
    `#graphql
      mutation setLimite($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: companyId,
            namespace: NS,
            key: KEY_LIMITE,
            type: "number_decimal",
            value: String(limite),
          },
        ],
      },
    },
  );
  const json: any = await resp.json();
  const errs = json.data?.metafieldsSet?.userErrors ?? [];
  if (errs.length > 0) {
    return { error: errs.map((e: any) => e.message).join(", ") };
  }
  return { ok: true, companyId, limite };
};


function nivelCredito(usado: number, limite: number): "ok" | "warn" | "over" {
  if (limite <= 0) return "ok";
  const pct = usado / limite;
  if (pct >= 1) return "over";
  if (pct >= 0.7) return "warn";
  return "ok";
}

// Barra de uso de crédito (visualización de datos; Polaris no trae charts).
function BarraCredito({ usado, limite }: { usado: number; limite: number }) {
  const nivel = nivelCredito(usado, limite);
  const pct = limite > 0 ? Math.min(100, (usado / limite) * 100) : 0;
  const color =
    nivel === "over" ? "#c5280c" : nivel === "warn" ? "#b28400" : "#29845a";
  return (
    <div style={{ height: 8, background: "#e6e6e8", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: color }} />
    </div>
  );
}

type Empresa = ReturnType<typeof useLoaderData<typeof loader>>["empresas"][number];

type FiltroId = "todas" | "credito" | "over" | "nolimit";
type OrdenId = "uso" | "riesgo" | "comprado" | "nombre";

export default function Empresas() {
  const { hasPro, empresas, currency, truncado } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  // Copia local para reflejar al instante el límite guardado, sin recargar.
  const [lista, setLista] = useState<Empresa[]>(empresas);
  useEffect(() => setLista(empresas), [empresas]);

  const [abiertaId, setAbiertaId] = useState<string | null>(null);
  const [limiteInput, setLimiteInput] = useState("");

  // Buscar / ordenar / filtrar (todo en cliente sobre la lista ya cargada).
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<FiltroId>("todas");
  const [orden, setOrden] = useState<OrdenId>("uso");

  const fmt = useMemo(
    () =>
      new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }),
    [currency],
  );

  // KPIs de cartera (sobre TODA la lista, no la filtrada).
  const kpis = useMemo(() => {
    let otorgado = 0,
      enUso = 0,
      disponible = 0,
      sobre = 0,
      conLimite = 0;
    for (const e of lista) {
      enUso += e.usado;
      if (e.limite > 0) {
        otorgado += e.limite;
        disponible += Math.max(0, e.limite - e.usado);
        conLimite += 1;
        if (e.usado >= e.limite) sobre += 1;
      }
    }
    return { otorgado, enUso, disponible, sobre, conLimite, total: lista.length };
  }, [lista]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const pct = (e: Empresa) => (e.limite > 0 ? e.usado / e.limite : 0);
    return lista
      .filter((e) => {
        if (q && !e.name.toLowerCase().includes(q)) return false;
        if (filtro === "credito") return e.limite > 0;
        if (filtro === "over") return e.limite > 0 && e.usado >= e.limite;
        if (filtro === "nolimit") return e.limite <= 0;
        return true;
      })
      .sort((a, b) => {
        if (orden === "nombre") return a.name.localeCompare(b.name, "es");
        if (orden === "comprado") return b.totalComprado - a.totalComprado;
        if (orden === "riesgo") return pct(b) - pct(a);
        return b.usado - a.usado; // "uso"
      });
  }, [lista, busqueda, filtro, orden]);

  const abierta = lista.find((e) => e.id === abiertaId) ?? null;

  const abrir = (e: Empresa) => {
    setAbiertaId(e.id);
    setLimiteInput(e.limite > 0 ? String(e.limite) : "");
  };
  const cerrar = () => setAbiertaId(null);

  const guardando = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) {
      const { companyId, limite } = fetcher.data;
      setLista((prev) =>
        prev.map((e) => (e.id === companyId ? { ...e, limite } : e)),
      );
      shopify.toast.show("Límite de crédito actualizado ✅");
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const guardarLimite = () => {
    if (!abierta) return;
    fetcher.submit(
      { companyId: abierta.id, limite: limiteInput || "0" },
      { method: "POST" },
    );
  };

  // -------- Teaser Pro --------
  if (!hasPro) {
    return (
      <s-page heading="Empresas B2B">
        <s-button slot="breadcrumbs" variant="tertiary" href="/app" icon="arrow-left">
          Inicio
        </s-button>
        <s-section heading="Empresas B2B es una función del Plan Pro">
          <s-stack gap="base">
            <s-stack direction="inline">
              <s-badge icon="lock" tone="info">Plan Pro</s-badge>
            </s-stack>
            <s-paragraph color="subdued">
              Gestiona a tus clientes empresariales con límites de crédito,
              control de saldo y términos de pago — todo en un panel pensado
              para ventas B2B.
            </s-paragraph>
            <s-unordered-list>
              <s-list-item>Límite de crédito por empresa</s-list-item>
              <s-list-item>Crédito en uso vs. disponible en tiempo real</s-list-item>
              <s-list-item>Términos de pago (Net 30 / 60) por cliente</s-list-item>
              <s-list-item>Historial de compras y cotizaciones</s-list-item>
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

  return (
    <s-page heading="Empresas B2B">
      <s-button slot="breadcrumbs" variant="tertiary" href="/app" icon="arrow-left">
        Inicio
      </s-button>

      {lista.length === 0 ? (
        <s-section heading="Aún no tienes empresas B2B">
          <s-paragraph color="subdued">
            Crea empresas desde tu admin de Shopify (Clientes → Empresas) o al
            asignar una empresa a una cotización. Aquí aparecerán con su línea
            de crédito y saldo.
          </s-paragraph>
        </s-section>
      ) : (
        <>
          {/* KPIs de cartera */}
          <s-section accessibilityLabel="Resumen de cartera B2B">
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))"
              gap="base"
            >
              <s-stack gap="small-300">
                <s-text color="subdued">Crédito otorgado</s-text>
                <s-heading>{fmt.format(kpis.otorgado)}</s-heading>
                <s-text color="subdued">{`${kpis.conLimite} empresas con límite`}</s-text>
              </s-stack>
              <s-stack gap="small-300">
                <s-text color="subdued">Crédito en uso</s-text>
                <s-heading>{fmt.format(kpis.enUso)}</s-heading>
                <s-text color="subdued">cotizaciones activas sin cobrar</s-text>
              </s-stack>
              <s-stack gap="small-300">
                <s-text color="subdued">Disponible</s-text>
                <s-heading>{fmt.format(kpis.disponible)}</s-heading>
                <s-text color="subdued">sobre el crédito otorgado</s-text>
              </s-stack>
              <s-stack gap="small-300">
                <s-text color="subdued">Sobre su límite</s-text>
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-heading>{`${kpis.sobre}`}</s-heading>
                  {kpis.sobre > 0 ? (
                    <s-badge tone="critical">
                      {kpis.sobre === 1 ? "empresa excedida" : "empresas excedidas"}
                    </s-badge>
                  ) : null}
                </s-stack>
              </s-stack>
            </s-grid>
          </s-section>

          {/* Detalle de la empresa seleccionada */}
          {abierta ? (
            <s-section heading={abierta.name}>
              <s-stack gap="base">
                <s-stack direction="inline" justifyContent="space-between">
                  <s-text color="subdued">
                    {abierta.contactoNombre
                      ? `Contacto: ${abierta.contactoNombre}`
                      : "Sin contacto principal"}
                  </s-text>
                  <s-button variant="tertiary" onClick={cerrar}>
                    Cerrar detalle
                  </s-button>
                </s-stack>

                <s-grid
                  gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
                  gap="base"
                >
                  <s-stack gap="small-300">
                    <s-text color="subdued">Correo de contacto</s-text>
                    <s-text>{abierta.contactoEmail || "—"}</s-text>
                  </s-stack>
                  <s-stack gap="small-300">
                    <s-text color="subdued">Términos de pago</s-text>
                    <s-text>{abierta.terminos || "—"}</s-text>
                  </s-stack>
                  <s-stack gap="small-300">
                    <s-text color="subdued">Cotizaciones activas</s-text>
                    <s-text>{`${abierta.activas}`}</s-text>
                  </s-stack>
                  <s-stack gap="small-300">
                    <s-text color="subdued">Pedidos completados</s-text>
                    <s-text>{`${abierta.ordenes}`}</s-text>
                  </s-stack>
                  <s-stack gap="small-300">
                    <s-text color="subdued">Total comprado (histórico)</s-text>
                    <s-text>{fmt.format(abierta.totalComprado)}</s-text>
                  </s-stack>
                  <s-stack gap="small-300">
                    <s-text color="subdued">Contactos / ubicaciones</s-text>
                    <s-text>{`${abierta.contactos} / ${abierta.ubicacionesCount}`}</s-text>
                  </s-stack>
                </s-grid>

                {/* Ubicaciones con sus términos y catálogo (lista de precios) */}
                {abierta.ubicaciones.length > 0 ? (
                  <s-stack gap="small-200">
                    <s-heading>Ubicaciones y catálogos</s-heading>
                    {abierta.ubicaciones.map((u: any) => (
                      <s-box
                        key={u.id}
                        border="base"
                        borderRadius="base"
                        padding="base"
                      >
                        <s-stack gap="small-300">
                          <s-text>{u.name}</s-text>
                          {u.dir ? <s-text color="subdued">{u.dir}</s-text> : null}
                          <s-stack direction="inline" gap="small-300">
                            {u.term ? (
                              <s-badge tone="info">{u.term}</s-badge>
                            ) : null}
                            {u.catalogos.map((c: any, i: number) => (
                              <s-badge
                                key={i}
                                tone={c.activo ? "success" : "neutral"}
                              >
                                {c.title}
                                {c.lista && c.lista !== c.title
                                  ? ` · ${c.lista}`
                                  : ""}
                              </s-badge>
                            ))}
                            {u.catalogos
                              .filter((c: any) => c.ajuste)
                              .map((c: any, i: number) => (
                                <s-badge key={`a${i}`} tone="caution">
                                  {c.ajuste}
                                </s-badge>
                              ))}
                            {!u.term && u.catalogos.length === 0 ? (
                              <s-badge tone="neutral">
                                Sin catálogo ni términos
                              </s-badge>
                            ) : null}
                          </s-stack>
                        </s-stack>
                      </s-box>
                    ))}
                    {abierta.ubicacionesCount > abierta.ubicaciones.length ? (
                      <s-text color="subdued">
                        +{abierta.ubicacionesCount - abierta.ubicaciones.length}{" "}
                        ubicaciones más
                      </s-text>
                    ) : null}
                  </s-stack>
                ) : null}

                {/* Línea de crédito */}
                <s-stack gap="small-300">
                  <s-heading>Línea de crédito</s-heading>
                  {abierta.limite > 0 ? (
                    <>
                      <BarraCredito
                        usado={abierta.usado}
                        limite={abierta.limite}
                      />
                      <s-stack direction="inline" justifyContent="space-between">
                        <s-text color="subdued">
                          En uso: {fmt.format(abierta.usado)}
                        </s-text>
                        <s-text color="subdued">
                          Disponible:{" "}
                          {fmt.format(
                            Math.max(0, abierta.limite - abierta.usado),
                          )}
                        </s-text>
                      </s-stack>
                    </>
                  ) : (
                    <s-text color="subdued">
                      Sin límite definido · en uso {fmt.format(abierta.usado)}
                    </s-text>
                  )}
                </s-stack>

                {/* Editar límite */}
                <s-stack direction="inline" gap="small-200" alignItems="end">
                  <s-text-field
                    label={`Límite de crédito (${currency})`}
                    placeholder="100000"
                    value={limiteInput}
                    onChange={(e: any) =>
                      setLimiteInput(
                        e.currentTarget.value.replace(/[^0-9.]/g, ""),
                      )
                    }
                  />
                  <s-button
                    variant="primary"
                    onClick={guardarLimite}
                    loading={guardando}
                  >
                    Guardar límite
                  </s-button>
                </s-stack>
              </s-stack>
            </s-section>
          ) : null}

          {/* Buscar / ordenar / filtrar + lista */}
          <s-section heading="Empresas">
            <s-stack gap="base">
              <s-stack direction="inline" gap="small-200" alignItems="end">
                <s-search-field
                  label="Buscar"
                  placeholder="Buscar empresa…"
                  value={busqueda}
                  onInput={(e: any) => setBusqueda(e.currentTarget.value)}
                />
                <s-select
                  label="Ordenar por"
                  value={orden}
                  onChange={(e: any) => setOrden(e.currentTarget.value as OrdenId)}
                >
                  <s-option value="uso">Más crédito en uso</s-option>
                  <s-option value="riesgo">Mayor % de su límite</s-option>
                  <s-option value="comprado">Más comprado (histórico)</s-option>
                  <s-option value="nombre">Nombre (A–Z)</s-option>
                </s-select>
              </s-stack>
              <s-stack direction="inline" gap="small-300" alignItems="center">
                {([
                  ["todas", "Todas"],
                  ["credito", "Con crédito"],
                  ["over", "Sobre límite"],
                  ["nolimit", "Sin límite"],
                ] as [FiltroId, string][]).map(([id, label]) => (
                  <s-button
                    key={id}
                    variant={filtro === id ? "primary" : "secondary"}
                    tone={id === "over" && filtro === id ? "critical" : undefined}
                    onClick={() => setFiltro(id)}
                  >
                    {label}
                  </s-button>
                ))}
                <s-text color="subdued">
                  {visibles.length} de {lista.length} empresas
                </s-text>
              </s-stack>

              {truncado ? (
                <s-banner tone="warning" heading="Datos parciales">
                  <s-paragraph>
                    Mostrando una parte de tus datos por volumen. Usa el
                    buscador para encontrar una empresa específica.
                  </s-paragraph>
                </s-banner>
              ) : null}

              {visibles.length === 0 ? (
                <s-paragraph color="subdued">
                  Ninguna empresa coincide con tu búsqueda o filtro.
                </s-paragraph>
              ) : (
                <s-grid
                  gridTemplateColumns="repeat(auto-fill, minmax(280px, 1fr))"
                  gap="base"
                >
                  {visibles.map((e) => (
                    <s-clickable key={e.id} onClick={() => abrir(e)}>
                      <s-box border="base" borderRadius="base" padding="base">
                        <s-stack gap="small-200">
                          <s-stack
                            direction="inline"
                            gap="small-200"
                            justifyContent="space-between"
                            alignItems="center"
                          >
                            <s-text>{e.name}</s-text>
                            {e.terminos ? (
                              <s-badge tone="info">{e.terminos}</s-badge>
                            ) : null}
                          </s-stack>
                          {e.contactoNombre ? (
                            <s-text color="subdued">{e.contactoNombre}</s-text>
                          ) : null}

                          {e.limite > 0 ? (
                            <s-stack gap="small-300">
                              <s-stack
                                direction="inline"
                                justifyContent="space-between"
                              >
                                <s-text color="subdued">Crédito en uso</s-text>
                                <s-text color="subdued">
                                  {fmt.format(e.usado)} / {fmt.format(e.limite)}
                                </s-text>
                              </s-stack>
                              <BarraCredito usado={e.usado} limite={e.limite} />
                            </s-stack>
                          ) : (
                            <s-text color="subdued">
                              Sin límite de crédito · toca para definir
                            </s-text>
                          )}

                          <s-stack direction="inline" gap="base">
                            <s-text color="subdued">{`${e.activas} activas`}</s-text>
                            <s-text color="subdued">{`${e.ordenes} pedidos`}</s-text>
                            {e.ubicacionesCount > 1 ? (
                              <s-text color="subdued">{`${e.ubicacionesCount} ubic.`}</s-text>
                            ) : null}
                          </s-stack>
                        </s-stack>
                      </s-box>
                    </s-clickable>
                  ))}
                </s-grid>
              )}
            </s-stack>
          </s-section>
        </>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
