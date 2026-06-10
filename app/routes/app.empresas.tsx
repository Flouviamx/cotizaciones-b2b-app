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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing } = await authenticate.admin(request);

  const proCheck = await billing.check({ plans: PLANES_PRO as any, isTest: BILLING_TEST });
  const hasPro = proCheck.hasActivePayment;

  // La función "Empresas B2B" es del Plan Pro. Sin Pro mostramos el teaser.
  if (!hasPro) {
    return { hasPro: false, empresas: [], currency: "MXN" };
  }

  // 1) Empresas con su límite de crédito (metafield) y datos de contacto.
  const compResp = await admin.graphql(
    `#graphql
      query empresasB2B {
        shop { currencyCode }
        companies(first: 50) {
          edges {
            node {
              id
              name
              ordersCount { count }
              totalSpent { amount }
              contactCount
              mainContact { customer { displayName email } }
              locations(first: 1) {
                edges {
                  node {
                    buyerExperienceConfiguration {
                      paymentTermsTemplate { name }
                    }
                  }
                }
              }
              metafield(namespace: "${NS}", key: "${KEY_LIMITE}") { value }
            }
          }
        }
      }`,
  );
  const compJson: any = await compResp.json();
  const currency = compJson.data?.shop?.currencyCode ?? "MXN";
  const companies = (compJson.data?.companies?.edges ?? []).map((e: any) => e.node);

  // 2) Cotizaciones (Draft Orders) para calcular el crédito EN USO por empresa
  //    = suma de las abiertas + enviadas (aún no cobradas).
  const doResp = await admin.graphql(
    `#graphql
      query draftPorEmpresa {
        draftOrders(first: 250, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              status
              totalPriceSet { presentmentMoney { amount } }
              purchasingEntity {
                __typename
                ... on PurchasingCompany { company { id } }
              }
            }
          }
        }
      }`,
  );
  const doJson: any = await doResp.json();
  const usoPorEmpresa = new Map<string, { usado: number; cotizaciones: number }>();
  for (const e of doJson.data?.draftOrders?.edges ?? []) {
    const n = e.node;
    const compId = n.purchasingEntity?.company?.id;
    if (!compId) continue;
    const cur = usoPorEmpresa.get(compId) ?? { usado: 0, cotizaciones: 0 };
    cur.cotizaciones += 1;
    if (n.status === "OPEN" || n.status === "INVOICE_SENT") {
      cur.usado += parseFloat(n.totalPriceSet?.presentmentMoney?.amount ?? "0");
    }
    usoPorEmpresa.set(compId, cur);
  }

  const empresas = companies.map((c: any) => {
    const uso = usoPorEmpresa.get(c.id) ?? { usado: 0, cotizaciones: 0 };
    const limite = c.metafield?.value ? parseFloat(c.metafield.value) : 0;
    return {
      id: c.id,
      name: c.name,
      limite,
      usado: uso.usado,
      cotizaciones: uso.cotizaciones,
      totalComprado: parseFloat(c.totalSpent?.amount ?? "0"),
      ordenes: c.ordersCount?.count ?? 0,
      contactos: c.contactCount ?? 0,
      contactoNombre: c.mainContact?.customer?.displayName ?? "",
      contactoEmail: c.mainContact?.customer?.email ?? "",
      terminos:
        c.locations?.edges?.[0]?.node?.buyerExperienceConfiguration
          ?.paymentTermsTemplate?.name ?? "",
    };
  });

  return { hasPro: true, empresas, currency };
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

.em-dr-edit { margin-top: 20px; }
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

export default function Empresas() {
  const { hasPro, empresas, currency } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  // Copia local para reflejar al instante el límite guardado, sin recargar.
  const [lista, setLista] = useState<Empresa[]>(empresas);
  useEffect(() => setLista(empresas), [empresas]);

  const [abiertaId, setAbiertaId] = useState<string | null>(null);
  const [limiteInput, setLimiteInput] = useState("");

  const fmt = useMemo(
    () =>
      new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }),
    [currency],
  );

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
          <div className="em-grid">
            {lista.map((e) => {
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
                      <b>{e.cotizaciones}</b> cotizaciones
                    </span>
                    <span className="it">
                      <b>{e.ordenes}</b> pedidos
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
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
                <span className="k">Cotizaciones</span>
                <span className="v">{abierta.cotizaciones}</span>
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
