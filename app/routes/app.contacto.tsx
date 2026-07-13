import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { sendContactMessage } from "../notify.server";

const SOPORTE_EMAIL = "soporte@flouvia.com";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const resp = await admin.graphql(
    `#graphql
      query contactoShop {
        shop { name email }
      }`,
  );
  const json: any = await resp.json();
  return {
    shopName: json.data?.shop?.name ?? "",
    shopEmail: json.data?.shop?.email ?? "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const remitente = String(formData.get("email") ?? "").trim();
  const asunto = String(formData.get("asunto") ?? "General").trim();
  const mensaje = String(formData.get("mensaje") ?? "").trim();

  if (!mensaje) {
    return { error: "Escribe un mensaje antes de enviar." };
  }

  // Nombre de la tienda para identificar quién escribe.
  let shopName = "";
  try {
    const resp = await admin.graphql(
      `#graphql
        query { shop { name } }`,
    );
    const json: any = await resp.json();
    shopName = json.data?.shop?.name ?? "";
  } catch {
    // no es crítico
  }

  const result = await sendContactMessage({
    shopName,
    remitente,
    asunto,
    mensaje,
  });

  if (!result.ok) {
    return { error: result.error ?? "No se pudo enviar el mensaje." };
  }
  return { ok: true };
};

const ASUNTOS = [
  "Soporte técnico",
  "Facturación / CFDI",
  "Planes y pagos",
  "Sugerencia o mejora",
  "Otro",
];

export default function Contacto() {
  const { shopName, shopEmail } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  const [email, setEmail] = useState(shopEmail);
  const [asunto, setAsunto] = useState(ASUNTOS[0]);
  const [mensaje, setMensaje] = useState("");

  const enviando = fetcher.state !== "idle";
  const enviado = fetcher.data?.ok === true;

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Mensaje enviado. Te responderemos pronto.");
      setMensaje("");
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const enviar = () => {
    if (!mensaje.trim()) {
      shopify.toast.show("Escribe un mensaje antes de enviar.", {
        isError: true,
      });
      return;
    }
    fetcher.submit({ email, asunto, mensaje }, { method: "POST" });
  };

  return (
    <s-page heading="Contacto">
      <s-button
        slot="breadcrumbs"
        variant="tertiary"
        href="/app"
        icon="arrow-left"
      >
        Inicio
      </s-button>

      {/* Formulario */}
      <s-section heading="Envíanos un mensaje">
        {enviado ? (
          <s-banner tone="success" heading="¡Gracias!">
            <s-paragraph>
              Recibimos tu mensaje y te responderemos a tu correo pronto.
            </s-paragraph>
          </s-banner>
        ) : (
          <s-stack gap="base">
            <s-paragraph color="subdued">
              ¿Tienes una duda, un problema o una idea para mejorar la app?
              Escríbenos y te respondemos lo antes posible.
            </s-paragraph>
            {fetcher.data?.error ? (
              <s-banner tone="critical" heading="No se pudo enviar">
                <s-paragraph>{fetcher.data.error}</s-paragraph>
              </s-banner>
            ) : null}

            <s-email-field
              label="Tu correo (para responderte)"
              placeholder="tucorreo@ejemplo.com"
              value={email}
              onChange={(e: any) => setEmail(e.currentTarget.value)}
            />
            <s-select
              label="Asunto"
              value={asunto}
              onChange={(e: any) => setAsunto(e.currentTarget.value)}
            >
              {ASUNTOS.map((a) => (
                <s-option key={a} value={a}>
                  {a}
                </s-option>
              ))}
            </s-select>
            <s-text-area
              label="Mensaje"
              placeholder="Cuéntanos en qué te podemos ayudar…"
              rows={6}
              value={mensaje}
              onChange={(e: any) => setMensaje(e.currentTarget.value)}
            />
            <s-stack direction="inline">
              <s-button variant="primary" onClick={enviar} loading={enviando}>
                Enviar mensaje
              </s-button>
            </s-stack>
          </s-stack>
        )}
      </s-section>

      {/* Datos de contacto directo */}
      <s-section heading="Otras formas de contacto">
        <s-stack gap="base">
          <s-stack gap="small-300">
            <s-heading>Email de soporte</s-heading>
            <s-link href={`mailto:${SOPORTE_EMAIL}`} target="_blank">
              {SOPORTE_EMAIL}
            </s-link>
          </s-stack>
          <s-divider />
          <s-stack gap="small-300">
            <s-heading>Tiempo de respuesta</s-heading>
            <s-paragraph color="subdued">
              Respondemos en menos de 24 horas hábiles.
            </s-paragraph>
            <s-stack direction="inline">
              <s-badge tone="success">Soporte en español</s-badge>
            </s-stack>
          </s-stack>
          <s-divider />
          <s-stack gap="small-300">
            <s-heading>Hecho para México</s-heading>
            <s-paragraph color="subdued">
              Cotizaciones B2B, crédito (Net 30/60) y facturación CFDI pensados
              para tu negocio.
            </s-paragraph>
          </s-stack>
          {shopName ? (
            <>
              <s-divider />
              <s-stack gap="small-300">
                <s-heading>Tu tienda</s-heading>
                <s-paragraph color="subdued">{shopName}</s-paragraph>
              </s-stack>
            </>
          ) : null}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
