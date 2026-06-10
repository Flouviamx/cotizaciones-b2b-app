import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { evaluarLimite } from "../limites.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const resp = await admin.graphql(
    `#graphql
      query newQuoteData {
        shop { currencyCode }
        customers(first: 50, sortKey: NAME) {
          edges { node { id displayName } }
        }
      }`,
  );
  const json: any = await resp.json();
  const customers = (json.data?.customers?.edges ?? []).map((e: any) => e.node);
  const currencyCode = json.data?.shop?.currencyCode ?? "MXN";
  const limite = await evaluarLimite(admin);
  return { customers, currencyCode, limite };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Tope del Plan Gratis: si ya llegó al máximo de cotizaciones activas, no deja crear.
  const limite = await evaluarLimite(admin);
  if (limite.bloqueado) {
    return {
      error: `Llegaste al límite de ${limite.limite} cotizaciones activas del Plan Gratis. Marca alguna como pagada o mejora tu plan para crear cotizaciones ilimitadas.`,
    };
  }

  const formData = await request.formData();

  const items = JSON.parse(String(formData.get("items") ?? "[]"));
  const customerId = String(formData.get("customerId") ?? "");
  const creditTerms = String(formData.get("creditTerms") ?? "");

  const lineItems = items
    .filter((it: any) => it.variantId)
    .map((it: any) => ({ variantId: it.variantId, quantity: it.quantity }));

  if (lineItems.length === 0) {
    return { error: "Agrega al menos un producto a la cotización." };
  }

  const input: any = { lineItems };
  if (customerId) input.purchasingEntity = { customerId };
  if (creditTerms) {
    input.customAttributes = [
      { key: "Términos de crédito", value: creditTerms },
    ];
  }

  const resp = await admin.graphql(
    `#graphql
      mutation createQuote($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { id }
          userErrors { field message }
        }
      }`,
    { variables: { input } },
  );
  const json: any = await resp.json();
  const errs = json.data?.draftOrderCreate?.userErrors ?? [];
  if (errs.length > 0) {
    return { error: errs.map((e: any) => e.message).join(", ") };
  }

  const newId = json.data?.draftOrderCreate?.draftOrder?.id;
  const numericId = String(newId).split("/").pop();
  return redirect(`/app/quotes/${numericId}`);
};

const CSS = `
.nq-wrap { max-width: 760px; margin: 0 auto; padding: 8px 16px 40px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; color: #1a1a2e; }
.nq-card { background: #fff; border: 1px solid #ececf0; border-radius: 16px; padding: 22px;
  margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.nq-card h2 { font-size: 16px; font-weight: 700; margin: 0 0 14px; }
.nq-btn { border: 0; border-radius: 11px; padding: 11px 16px; font-size: 14px; font-weight: 700; cursor: pointer; }
.nq-btn.primary { background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff; }
.nq-btn.ghost { background: #fff; border: 1.5px solid #1a73e8; color: #1a73e8; }
.nq-btn.ghost:hover { background: #f5f9ff; }
.nq-item { display: flex; gap: 14px; align-items: center; padding: 12px; border: 1px solid #ececf0;
  border-radius: 12px; margin-top: 10px; flex-wrap: wrap; }
.nq-item img { width: 52px; height: 52px; border-radius: 10px; object-fit: cover; flex-shrink: 0; }
.nq-item .info { flex: 1; min-width: 140px; }
.nq-item .info .t { font-size: 14px; font-weight: 600; }
.nq-item .info .p { font-size: 13px; color: #6b7280; margin-top: 2px; }
.nq-item .qty { width: 76px; padding: 8px; border: 1px solid #d8d8e0; border-radius: 9px; font-size: 14px; text-align: center; }
.nq-item .rm { background: transparent; border: 0; color: #dc2626; font-size: 13px; font-weight: 600; cursor: pointer; }
.nq-empty { text-align: center; color: #6b7280; padding: 28px; border: 1px dashed #d8d8e0; border-radius: 12px; margin-top: 12px; }
.nq-total { margin-top: 14px; font-size: 15px; font-weight: 700; }
.nq-label { display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px; }
.nq-select { width: 100%; padding: 11px 12px; border: 1px solid #d8d8e0; border-radius: 10px; font-size: 14px;
  background: #fff; color: #1a1a2e; outline: none; }
.nq-select:focus { border-color: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,.15); }
.nq-limit { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; border-radius: 14px;
  padding: 14px 16px; margin-bottom: 16px; font-size: 14px; line-height: 1.5; }
.nq-limit b { display: block; margin-bottom: 2px; }
.nq-limit-cta { display: inline-block; margin-top: 8px; color: #1a56c4; font-weight: 700; text-decoration: none; }
.nq-limit-cta:hover { text-decoration: underline; }
.nq-usage { font-size: 13px; font-weight: 600; color: #6b7280; margin-bottom: 14px;
  background: #f5f9ff; border: 1px solid #cfe0fc; border-radius: 10px; padding: 8px 12px; display: inline-block; }
`;

export default function NewQuote() {
  const { customers, currencyCode, limite } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  const [items, setItems] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [creditTerms, setCreditTerms] = useState("Contado");

  const isCreating = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const seleccionarProductos = async () => {
    const selection = await shopify.resourcePicker({
      type: "product",
      multiple: true,
    });
    if (!selection) return;
    const picked = selection
      .map((p: any) => {
        const variant = p.variants?.[0];
        if (!variant) return null;
        return {
          title: p.title,
          variantId: variant.id,
          price: variant.price ?? "0",
          image: p.images?.[0]?.originalSrc ?? p.images?.[0]?.src ?? null,
          quantity: 1,
        };
      })
      .filter(Boolean);
    setItems((prev) => {
      const ids = new Set(prev.map((p) => p.variantId));
      return [...prev, ...picked.filter((p: any) => !ids.has(p.variantId))];
    });
  };

  const setQty = (i: number, val: string) =>
    setItems((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], quantity: Number(val) || 1 };
      return next;
    });

  const quitar = (i: number) =>
    setItems((prev) => prev.filter((_, idx) => idx !== i));

  const total = items.reduce(
    (sum, it) => sum + Number(it.price || 0) * it.quantity,
    0,
  );

  const crear = () => {
    if (limite.bloqueado) {
      shopify.toast.show(
        `Llegaste al límite de ${limite.limite} cotizaciones del Plan Gratis. Mejora tu plan para seguir.`,
        { isError: true },
      );
      return;
    }
    fetcher.submit(
      { items: JSON.stringify(items), customerId, creditTerms },
      { method: "POST" },
    );
  };

  return (
    <s-page heading="Nueva cotización">
      <s-button
        slot="breadcrumbs"
        variant="tertiary"
        href="/app/quotes"
        icon="arrow-left"
      >
        Cotizaciones
      </s-button>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={crear}
        {...(limite.bloqueado ? { disabled: true } : {})}
        {...(isCreating ? { loading: true } : {})}
      >
        Crear cotización
      </s-button>

      <style>{CSS}</style>

      <div className="nq-wrap">
        {/* Aviso de límite del Plan Gratis */}
        {limite.bloqueado ? (
          <div className="nq-limit">
            <b>Llegaste al límite del Plan Gratis ({limite.limite} cotizaciones)</b>
            Marca alguna cotización como pagada para liberar espacio, o mejora tu
            plan para crear cotizaciones <strong>ilimitadas</strong>.
            <a href="/app/plans" className="nq-limit-cta">Ver planes →</a>
          </div>
        ) : !limite.paid ? (
          <div className="nq-usage">
            Plan Gratis · {limite.activas} de {limite.limite} cotizaciones activas
          </div>
        ) : null}

        {/* Productos */}
        <div className="nq-card">
          <h2>Productos</h2>
          <button className="nq-btn ghost" onClick={seleccionarProductos}>
            + Seleccionar productos
          </button>

          {items.length === 0 ? (
            <div className="nq-empty">
              Aún no has agregado productos. Usa el botón de arriba.
            </div>
          ) : (
            items.map((it: any, i: number) => (
              <div className="nq-item" key={it.variantId}>
                {it.image ? <img src={it.image} alt={it.title} /> : null}
                <div className="info">
                  <div className="t">{it.title}</div>
                  <div className="p">
                    {Number(it.price).toFixed(2)} {currencyCode} c/u
                  </div>
                </div>
                <input
                  className="qty"
                  type="number"
                  min={1}
                  value={it.quantity}
                  onChange={(e) => setQty(i, e.target.value)}
                />
                <button className="rm" onClick={() => quitar(i)}>
                  Quitar
                </button>
              </div>
            ))
          )}

          {items.length > 0 ? (
            <div className="nq-total">
              {items.length} producto(s) · Total estimado: {total.toFixed(2)}{" "}
              {currencyCode}
            </div>
          ) : null}
        </div>

        {/* Términos de crédito */}
        <div className="nq-card">
          <h2>Términos de crédito</h2>
          <label className="nq-label">Forma de pago</label>
          <select
            className="nq-select"
            value={creditTerms}
            onChange={(e) => setCreditTerms(e.target.value)}
          >
            <option value="Contado">Contado (pago inmediato)</option>
            <option value="Net 30">Net 30 (30 días)</option>
            <option value="Net 60">Net 60 (60 días)</option>
          </select>
        </div>

        {/* Cliente */}
        <div className="nq-card">
          <h2>Cliente (opcional)</h2>
          {customers.length === 0 ? (
            <p style={{ color: "#6b7280", fontSize: 14 }}>
              No hay clientes en la tienda. Puedes crear la cotización sin
              cliente y asignarlo después.
            </p>
          ) : (
            <select
              className="nq-select"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">— Sin cliente —</option>
              {customers.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
