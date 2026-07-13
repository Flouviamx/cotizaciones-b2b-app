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

      {/* Aviso de límite del Plan Gratis */}
      {limite.bloqueado ? (
        <s-banner
          tone="warning"
          heading={`Llegaste al límite del Plan Gratis (${limite.limite} cotizaciones)`}
        >
          <s-paragraph>
            Marca alguna cotización como pagada para liberar espacio, o{" "}
            <s-link href="/app/plans">mejora tu plan</s-link> para crear
            cotizaciones ilimitadas.
          </s-paragraph>
        </s-banner>
      ) : null}

      {/* Productos */}
      <s-section heading="Productos">
        <s-stack gap="base">
          {!limite.paid && !limite.bloqueado ? (
            <s-text color="subdued">
              Plan Gratis · {limite.activas} de {limite.limite} cotizaciones
              activas
            </s-text>
          ) : null}
          <s-stack direction="inline">
            <s-button icon="plus" onClick={seleccionarProductos}>
              Seleccionar productos
            </s-button>
          </s-stack>

          {items.length === 0 ? (
            <s-paragraph color="subdued">
              Aún no has agregado productos. Usa el botón de arriba.
            </s-paragraph>
          ) : (
            items.map((it: any, i: number) => (
              <s-stack gap="small-200" key={it.variantId}>
                {i > 0 ? <s-divider /> : null}
                <s-stack
                  direction="inline"
                  gap="base"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-stack direction="inline" gap="base" alignItems="center">
                    {it.image ? (
                      <s-thumbnail src={it.image} alt={it.title} />
                    ) : null}
                    <s-stack gap="small-300">
                      <s-text>{it.title}</s-text>
                      <s-text color="subdued">
                        {Number(it.price).toFixed(2)} {currencyCode} c/u
                      </s-text>
                    </s-stack>
                  </s-stack>
                  <s-stack direction="inline" gap="small-200" alignItems="end">
                    <s-number-field
                      label="Cantidad"
                      min={1}
                      value={`${it.quantity}`}
                      onChange={(e: any) => setQty(i, e.currentTarget.value)}
                    />
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => quitar(i)}
                    >
                      Quitar
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-stack>
            ))
          )}

          {items.length > 0 ? (
            <s-text>
              {items.length} producto(s) · Total estimado: {total.toFixed(2)}{" "}
              {currencyCode}
            </s-text>
          ) : null}
        </s-stack>
      </s-section>

      {/* Términos de crédito */}
      <s-section heading="Términos de crédito">
        <s-select
          label="Forma de pago"
          value={creditTerms}
          onChange={(e: any) => setCreditTerms(e.currentTarget.value)}
        >
          <s-option value="Contado">Contado (pago inmediato)</s-option>
          <s-option value="Net 30">Net 30 (30 días)</s-option>
          <s-option value="Net 60">Net 60 (60 días)</s-option>
        </s-select>
      </s-section>

      {/* Cliente */}
      <s-section heading="Cliente (opcional)">
        {customers.length === 0 ? (
          <s-paragraph color="subdued">
            No hay clientes en la tienda. Puedes crear la cotización sin
            cliente y asignarlo después.
          </s-paragraph>
        ) : (
          <s-select
            label="Cliente"
            value={customerId}
            onChange={(e: any) => setCustomerId(e.currentTarget.value)}
          >
            <s-option value="">— Sin cliente —</s-option>
            {customers.map((c: any) => (
              <s-option key={c.id} value={c.id}>
                {c.displayName}
              </s-option>
            ))}
          </s-select>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
