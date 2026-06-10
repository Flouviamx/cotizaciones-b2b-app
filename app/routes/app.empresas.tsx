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

const CSS = `
.em-wrap { max-width: 1040px; margin: 0 auto; padding: 8px 16px 48px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; color: #1a1a2e; }

.em-hero { position: relative; overflow: hidden; border-radius: 20px; padding: 26px 28px;
  background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff;
  box-shadow: 0 14px 34px -12px rgba(26,115,232,.5); margin: 8px 0 22px; }
.em-hero::after { content: ""; position: absolute; top: -60px; right: -40px; width: 220px; height: 220px;
  background: rgba(255,255,255,.12); border-radius: 50%; }
.em-hero h1 { font-size: 26px; font-weight: 800; margin: 0 0 6px; letter-spacing: -0.02em; position: relative; }
.em-hero p { font-size: 15px; margin: 0; opacity: .92; position: relative; max-width: 580px; }

/* Panel de KPIs de cartera B2B */
.em-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 18px; }
.em-kpi { background: #fff; border: 1px solid #ececf0; border-radius: 16px; padding: 16px 18px;
  box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.em-kpi .kl { font-size: 12px; color: #6b7280; font-weight: 700; display: flex; align-items: center; gap: 6px; }
.em-kpi .kv { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; margin-top: 6px; line-height: 1.1; }
.em-kpi .ks { font-size: 11.5px; color: #9099a8; font-weight: 600; margin-top: 3px; }
.em-kpi.alert { background: linear-gradient(135deg, #fff5f5, #fff); border-color: #f6caca; }
.em-kpi.alert .kv { color: #dc2626; }

/* Barra de herramientas: buscar + ordenar + filtros */
.em-tools { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 16px; }
.em-search { position: relative; flex: 1 1 240px; min-width: 200px; }
.em-search input { width: 100%; padding: 10px 12px 10px 36px; border: 1px solid #d8d8e0; border-radius: 11px;
  font-size: 14px; outline: none; font-family: inherit; background: #fff; }
.em-search input:focus { border-color: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,.15); }
.em-search .ic { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 14px; opacity: .5; }
.em-sort { padding: 10px 12px; border: 1px solid #d8d8e0; border-radius: 11px; font-size: 13.5px;
  font-family: inherit; background: #fff; font-weight: 600; color: #374151; outline: none; cursor: pointer; }
.em-sort:focus { border-color: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,.15); }
.em-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.em-chip { border: 1px solid #d8d8e0; background: #fff; border-radius: 999px; padding: 8px 13px;
  font-size: 12.5px; font-weight: 700; color: #6b7280; cursor: pointer; transition: all .12s; }
.em-chip:hover { border-color: #cfe0fc; }
.em-chip.on { background: #1a73e8; border-color: #1a73e8; color: #fff; }
.em-chip.on.warn { background: #dc2626; border-color: #dc2626; }
.em-count { font-size: 12.5px; color: #9099a8; font-weight: 600; margin-bottom: 14px; }
.em-trunc { font-size: 12.5px; color: #92600a; background: #fff8eb; border: 1px solid #f3e0b5;
  border-radius: 10px; padding: 9px 12px; margin-bottom: 14px; font-weight: 600; }

/* Grid de empresas */
.em-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.em-card { background: #fff; border: 1px solid #ececf0; border-radius: 18px; padding: 20px 22px;
  box-shadow: 0 1px 3px rgba(0,0,0,.04); cursor: pointer; transition: box-shadow .15s, transform .15s, border-color .15s; }
.em-card:hover { box-shadow: 0 12px 28px -14px rgba(0,0,0,.22); transform: translateY(-2px); border-color: #cfe0fc; }
.em-card .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 16px; }
.em-card .nm { font-size: 16px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.25; }
.em-card .ct { font-size: 12.5px; color: #9099a8; font-weight: 600; margin-top: 3px; }
.em-term { flex-shrink: 0; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px;
  background: #eef3ff; color: #1a56c4; white-space: nowrap; }

.em-credit .crow { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 7px; }
.em-credit .crow .l { font-size: 12px; color: #6b7280; font-weight: 700; }
.em-credit .crow .v { font-size: 13px; font-weight: 800; }
.em-track { height: 10px; background: #eef0f4; border-radius: 999px; overflow: hidden; }
.em-track span { display: block; height: 100%; border-radius: 999px; transition: width .6s cubic-bezier(.2,.8,.3,1); }
.em-track span.ok { background: linear-gradient(90deg, #16a34a, #22c55e); }
.em-track span.warn { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
.em-track span.over { background: linear-gradient(90deg, #dc2626, #ef4444); }
.em-nolimit { font-size: 12.5px; color: #9099a8; font-weight: 600; padding: 6px 0; }
.em-nolimit b { color: #1a56c4; }

.em-foot { display: flex; gap: 14px; margin-top: 16px; padding-top: 14px; border-top: 1px solid #f1f1f4; }
.em-foot .it { font-size: 12.5px; color: #6b7280; font-weight: 600; }
.em-foot .it b { color: #1a1a2e; font-weight: 800; }

.em-empty { text-align: center; color: #6b7280; padding: 40px 20px; border: 1px dashed #d8d8e0;
  border-radius: 16px; background: #fafafb; }
.em-empty .ic { font-size: 40px; margin-bottom: 12px; }
.em-empty .t { font-size: 16px; font-weight: 750; color: #1a1a2e; margin-bottom: 6px; }
.em-empty .d { font-size: 13.5px; line-height: 1.55; max-width: 460px; margin: 0 auto; }

/* Teaser Pro (sin plan) */
.em-lock { background: linear-gradient(135deg, #f7faff, #eef5ff); border: 1px solid #cfe0fc;
  border-radius: 20px; padding: 40px 32px; text-align: center; }
.em-lock .ic { font-size: 46px; margin-bottom: 14px; }
.em-lock .t { font-size: 20px; font-weight: 800; margin-bottom: 8px; letter-spacing: -0.02em; }
.em-lock .d { font-size: 14.5px; color: #4b5563; line-height: 1.6; max-width: 480px; margin: 0 auto 22px; }
.em-lock .feats { display: grid; gap: 10px; max-width: 380px; margin: 0 auto 24px; text-align: left; }
.em-lock .feats li { display: flex; gap: 9px; font-size: 14px; color: #374151; }
.em-lock .feats .chk { flex: 0 0 20px; width: 20px; height: 20px; border-radius: 999px; background: #dcfce7;
  color: #16a34a; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; }
.em-lock .cta { border: 0; border-radius: 12px; padding: 13px 28px; font-size: 15px; font-weight: 800;
  cursor: pointer; color: #fff; background: linear-gradient(135deg, #1a73e8, #4285f4);
  box-shadow: 0 10px 24px -10px rgba(26,115,232,.6); }
.em-lock .cta:hover { opacity: .92; }

/* Drawer lateral */
.em-overlay { position: fixed; inset: 0; background: rgba(15,18,30,.42); z-index: 60; opacity: 0;
  pointer-events: none; transition: opacity .25s; }
.em-overlay.show { opacity: 1; pointer-events: auto; }
.em-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: 420px; max-width: 92vw; background: #fff;
  z-index: 61; box-shadow: -20px 0 50px -20px rgba(0,0,0,.4); transform: translateX(100%);
  transition: transform .3s cubic-bezier(.2,.9,.3,1); display: flex; flex-direction: column; }
.em-drawer.show { transform: translateX(0); }
.em-dr-head { padding: 22px 24px; border-bottom: 1px solid #eef0f4;
  background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff; }
.em-dr-head .nm { font-size: 19px; font-weight: 800; letter-spacing: -0.02em; }
.em-dr-head .ct { font-size: 13px; opacity: .9; margin-top: 4px; }
.em-dr-body { padding: 22px 24px; overflow-y: auto; flex: 1; }
.em-dr-row { display: flex; justify-content: space-between; align-items: center; gap: 12px;
  padding: 13px 0; border-top: 1px solid #f1f1f4; }
.em-dr-row:first-child { border-top: 0; padding-top: 0; }
.em-dr-row .k { font-size: 13.5px; color: #6b7280; font-weight: 600; }
.em-dr-row .v { font-size: 14px; font-weight: 800; text-align: right; }
.em-dr-row .v.email { font-weight: 600; font-size: 13px; color: #1a56c4; }

.em-dr-credit { margin-top: 20px; background: #f7faff; border: 1px solid #e2ecfb; border-radius: 14px; padding: 18px; }
.em-dr-credit .lbl { font-size: 13px; font-weight: 700; color: #374151; margin-bottom: 10px; }
.em-dr-credit .track { height: 12px; background: #e5e9f2; border-radius: 999px; overflow: hidden; margin-bottom: 8px; }
.em-dr-credit .track span { display: block; height: 100%; border-radius: 999px; }
.em-dr-credit .track span.ok { background: linear-gradient(90deg, #16a34a, #22c55e); }
.em-dr-credit .track span.warn { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
.em-dr-credit .track span.over { background: linear-gradient(90deg, #dc2626, #ef4444); }
.em-dr-credit .nums { display: flex; justify-content: space-between; font-size: 12.5px; color: #6b7280; font-weight: 600; }

/* Ubicaciones + catálogos en el drawer */
.em-dr-locs { margin-top: 22px; }
.em-dr-locs .hd { font-size: 13px; font-weight: 800; color: #374151; margin-bottom: 10px;
  display: flex; align-items: center; gap: 7px; }
.em-loc { border: 1px solid #ececf0; border-radius: 13px; padding: 13px 15px; margin-bottom: 10px; background: #fcfcfd; }
.em-loc .ln { font-size: 14px; font-weight: 800; letter-spacing: -0.01em; }
.em-loc .la { font-size: 12.5px; color: #9099a8; font-weight: 600; margin-top: 2px; }
.em-loc .lmeta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.em-tag { font-size: 11px; font-weight: 700; padding: 4px 9px; border-radius: 999px; white-space: nowrap; }
.em-tag.term { background: #eef3ff; color: #1a56c4; }
.em-tag.cat { background: #f0fdf4; color: #15803d; }
.em-tag.catoff { background: #f3f4f6; color: #9099a8; }
.em-tag.adj { background: #fef3e8; color: #b45309; }

.em-dr-edit { margin-top: 22px; }
.em-dr-edit label { display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px; }
.em-dr-input { display: flex; gap: 8px; }
.em-dr-input .pre { display: flex; align-items: center; padding: 0 12px; border: 1px solid #d8d8e0;
  border-right: 0; border-radius: 10px 0 0 10px; background: #f7f8fa; font-size: 14px; font-weight: 700; color: #6b7280; }
.em-dr-input input { flex: 1; padding: 11px 12px; border: 1px solid #d8d8e0; border-radius: 0 10px 10px 0;
  font-size: 14px; outline: none; font-family: inherit; }
.em-dr-input input:focus { border-color: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,.15); }
.em-dr-save { margin-top: 14px; width: 100%; border: 0; border-radius: 12px; padding: 13px; font-size: 15px;
  font-weight: 700; cursor: pointer; color: #fff; background: linear-gradient(135deg, #1a73e8, #4285f4); }
.em-dr-save:hover { opacity: .92; }
.em-dr-save:disabled { opacity: .6; cursor: default; }

@media (max-width: 720px) { .em-hero h1 { font-size: 22px; } }
`;

function nivelCredito(usado: number, limite: number): "ok" | "warn" | "over" {
  if (limite <= 0) return "ok";
  const pct = usado / limite;
  if (pct >= 1) return "over";
  if (pct >= 0.7) return "warn";
  return "ok";
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
        <style>{CSS}</style>
        <div className="em-wrap">
          <div className="em-lock">
            <div className="ic">🏢🔒</div>
            <div className="t">Empresas B2B es una función del Plan Pro</div>
            <div className="d">
              Gestiona a tus clientes empresariales con límites de crédito,
              control de saldo y términos de pago — todo en un panel pensado
              para ventas B2B.
            </div>
            <ul className="feats" style={{ listStyle: "none", padding: 0 }}>
              <li><span className="chk">✓</span> Límite de crédito por empresa</li>
              <li><span className="chk">✓</span> Crédito en uso vs. disponible en tiempo real</li>
              <li><span className="chk">✓</span> Términos de pago (Net 30 / 60) por cliente</li>
              <li><span className="chk">✓</span> Historial de compras y cotizaciones</li>
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
    <s-page heading="Empresas B2B">
      <s-button slot="breadcrumbs" variant="tertiary" href="/app" icon="arrow-left">
        Inicio
      </s-button>
      <style>{CSS}</style>

      <div className="em-wrap">
        <div className="em-hero">
          <h1>Empresas B2B 🏢</h1>
          <p>
            Tus clientes empresariales con su línea de crédito, saldo en uso y
            términos de pago. Toca una empresa para ver el detalle y ajustar su
            límite.
          </p>
        </div>

        {lista.length === 0 ? (
          <div className="em-empty">
            <div className="ic">🏢</div>
            <div className="t">Aún no tienes empresas B2B</div>
            <div className="d">
              Crea empresas desde tu admin de Shopify (Clientes → Empresas) o al
              asignar una empresa a una cotización. Aquí aparecerán con su línea
              de crédito y saldo.
            </div>
          </div>
        ) : (
          <>
            {/* KPIs de cartera */}
            <div className="em-kpis">
              <div className="em-kpi">
                <div className="kl">💳 Crédito otorgado</div>
                <div className="kv">{fmt.format(kpis.otorgado)}</div>
                <div className="ks">{kpis.conLimite} empresas con límite</div>
              </div>
              <div className="em-kpi">
                <div className="kl">📊 Crédito en uso</div>
                <div className="kv">{fmt.format(kpis.enUso)}</div>
                <div className="ks">cotizaciones activas sin cobrar</div>
              </div>
              <div className="em-kpi">
                <div className="kl">✅ Disponible</div>
                <div className="kv">{fmt.format(kpis.disponible)}</div>
                <div className="ks">sobre el crédito otorgado</div>
              </div>
              <div className={`em-kpi ${kpis.sobre > 0 ? "alert" : ""}`}>
                <div className="kl">⚠️ Sobre su límite</div>
                <div className="kv">{kpis.sobre}</div>
                <div className="ks">
                  {kpis.sobre === 1 ? "empresa excedida" : "empresas excedidas"}
                </div>
              </div>
            </div>

            {/* Buscar / ordenar / filtrar */}
            <div className="em-tools">
              <div className="em-search">
                <span className="ic">🔍</span>
                <input
                  type="text"
                  placeholder="Buscar empresa…"
                  value={busqueda}
                  onChange={(ev) => setBusqueda(ev.target.value)}
                />
              </div>
              <select
                className="em-sort"
                value={orden}
                onChange={(ev) => setOrden(ev.target.value as OrdenId)}
              >
                <option value="uso">Más crédito en uso</option>
                <option value="riesgo">Mayor % de su límite</option>
                <option value="comprado">Más comprado (histórico)</option>
                <option value="nombre">Nombre (A–Z)</option>
              </select>
              <div className="em-chips">
                {([
                  ["todas", "Todas"],
                  ["credito", "Con crédito"],
                  ["over", "Sobre límite"],
                  ["nolimit", "Sin límite"],
                ] as [FiltroId, string][]).map(([id, label]) => (
                  <button
                    key={id}
                    className={`em-chip ${filtro === id ? "on" : ""} ${id === "over" ? "warn" : ""}`}
                    onClick={() => setFiltro(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {truncado ? (
              <div className="em-trunc">
                Mostrando una parte de tus datos por volumen. Usa el buscador para
                encontrar una empresa específica.
              </div>
            ) : null}

            <div className="em-count">
              {visibles.length} de {lista.length} empresas
            </div>

            {visibles.length === 0 ? (
              <div className="em-empty">
                <div className="ic">🔍</div>
                <div className="t">Sin resultados</div>
                <div className="d">
                  Ninguna empresa coincide con tu búsqueda o filtro.
                </div>
              </div>
            ) : (
              <div className="em-grid">
                {visibles.map((e) => {
                  const nivel = nivelCredito(e.usado, e.limite);
                  const pct =
                    e.limite > 0
                      ? Math.min(100, (e.usado / e.limite) * 100)
                      : 0;
                  return (
                    <div className="em-card" key={e.id} onClick={() => abrir(e)}>
                      <div className="head">
                        <div>
                          <div className="nm">{e.name}</div>
                          {e.contactoNombre ? (
                            <div className="ct">{e.contactoNombre}</div>
                          ) : null}
                        </div>
                        {e.terminos ? (
                          <span className="em-term">{e.terminos}</span>
                        ) : null}
                      </div>

                      <div className="em-credit">
                        {e.limite > 0 ? (
                          <>
                            <div className="crow">
                              <span className="l">Crédito en uso</span>
                              <span className="v">
                                {fmt.format(e.usado)} / {fmt.format(e.limite)}
                              </span>
                            </div>
                            <div className="em-track">
                              <span className={nivel} style={{ width: `${pct}%` }} />
                            </div>
                          </>
                        ) : (
                          <div className="em-nolimit">
                            Sin límite de crédito · <b>toca para definir</b>
                          </div>
                        )}
                      </div>

                      <div className="em-foot">
                        <span className="it">
                          <b>{e.activas}</b> activas
                        </span>
                        <span className="it">
                          <b>{e.ordenes}</b> pedidos
                        </span>
                        {e.ubicacionesCount > 1 ? (
                          <span className="it">
                            <b>{e.ubicacionesCount}</b> ubic.
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Drawer de detalle */}
      <div className={`em-overlay ${abierta ? "show" : ""}`} onClick={cerrar} />
      <div className={`em-drawer ${abierta ? "show" : ""}`}>
        {abierta ? (
          <>
            <div className="em-dr-head">
              <div className="nm">{abierta.name}</div>
              {abierta.contactoNombre ? (
                <div className="ct">Contacto: {abierta.contactoNombre}</div>
              ) : null}
            </div>
            <div className="em-dr-body">
              <div className="em-dr-row">
                <span className="k">Correo de contacto</span>
                <span className="v email">{abierta.contactoEmail || "—"}</span>
              </div>
              <div className="em-dr-row">
                <span className="k">Términos de pago</span>
                <span className="v">{abierta.terminos || "—"}</span>
              </div>
              <div className="em-dr-row">
                <span className="k">Cotizaciones activas</span>
                <span className="v">{abierta.activas}</span>
              </div>
              <div className="em-dr-row">
                <span className="k">Pedidos completados</span>
                <span className="v">{abierta.ordenes}</span>
              </div>
              <div className="em-dr-row">
                <span className="k">Total comprado (histórico)</span>
                <span className="v">{fmt.format(abierta.totalComprado)}</span>
              </div>
              <div className="em-dr-row">
                <span className="k">Contactos en la empresa</span>
                <span className="v">{abierta.contactos}</span>
              </div>
              <div className="em-dr-row">
                <span className="k">Ubicaciones</span>
                <span className="v">{abierta.ubicacionesCount}</span>
              </div>

              {/* Ubicaciones con sus términos y catálogo (lista de precios) */}
              {abierta.ubicaciones.length > 0 ? (
                <div className="em-dr-locs">
                  <div className="hd">📍 Ubicaciones y catálogos</div>
                  {abierta.ubicaciones.map((u: any) => (
                    <div className="em-loc" key={u.id}>
                      <div className="ln">{u.name}</div>
                      {u.dir ? <div className="la">{u.dir}</div> : null}
                      <div className="lmeta">
                        {u.term ? (
                          <span className="em-tag term">{u.term}</span>
                        ) : null}
                        {u.catalogos.map((c: any, i: number) => (
                          <span
                            key={i}
                            className={`em-tag ${c.activo ? "cat" : "catoff"}`}
                          >
                            {c.title}
                            {c.lista && c.lista !== c.title ? ` · ${c.lista}` : ""}
                          </span>
                        ))}
                        {u.catalogos
                          .filter((c: any) => c.ajuste)
                          .map((c: any, i: number) => (
                            <span key={`a${i}`} className="em-tag adj">
                              {c.ajuste}
                            </span>
                          ))}
                        {!u.term && u.catalogos.length === 0 ? (
                          <span className="em-tag catoff">
                            Sin catálogo ni términos
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {abierta.ubicacionesCount > abierta.ubicaciones.length ? (
                    <div className="la" style={{ marginTop: 4 }}>
                      +{abierta.ubicacionesCount - abierta.ubicaciones.length} ubicaciones más
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Barra de crédito */}
              <div className="em-dr-credit">
                <div className="lbl">Línea de crédito</div>
                {abierta.limite > 0 ? (
                  <>
                    <div className="track">
                      <span
                        className={nivelCredito(abierta.usado, abierta.limite)}
                        style={{
                          width: `${Math.min(100, (abierta.usado / abierta.limite) * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="nums">
                      <span>En uso: {fmt.format(abierta.usado)}</span>
                      <span>
                        Disponible:{" "}
                        {fmt.format(Math.max(0, abierta.limite - abierta.usado))}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="nums">
                    <span>Sin límite definido · en uso {fmt.format(abierta.usado)}</span>
                  </div>
                )}
              </div>

              {/* Editar límite */}
              <div className="em-dr-edit">
                <label>Límite de crédito ({currency})</label>
                <div className="em-dr-input">
                  <span className="pre">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="100000"
                    value={limiteInput}
                    onChange={(e) =>
                      setLimiteInput(e.target.value.replace(/[^0-9.]/g, ""))
                    }
                  />
                </div>
                <button
                  className="em-dr-save"
                  onClick={guardarLimite}
                  disabled={guardando}
                >
                  {guardando ? "Guardando…" : "Guardar límite"}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
