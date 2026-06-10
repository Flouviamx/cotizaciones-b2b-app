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

const CSS = `
.ct-wrap { max-width: 900px; margin: 0 auto; padding: 8px 16px 48px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; color: #1a1a2e; }

.ct-hero { border-radius: 20px; padding: 26px 28px; margin: 8px 0 22px; position: relative; overflow: hidden;
  background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff;
  box-shadow: 0 14px 34px -12px rgba(26,115,232,.5); }
.ct-hero::after { content: ""; position: absolute; top: -60px; right: -40px; width: 220px; height: 220px;
  background: rgba(255,255,255,.12); border-radius: 50%; }
.ct-hero h1 { font-size: 26px; font-weight: 800; margin: 0 0 6px; letter-spacing: -0.02em; position: relative; }
.ct-hero p { font-size: 15px; margin: 0; opacity: .92; position: relative; max-width: 560px; }

.ct-cols { display: grid; grid-template-columns: 1.4fr 1fr; gap: 18px; align-items: start; }
.ct-card { background: #fff; border: 1px solid #ececf0; border-radius: 18px; padding: 24px;
  box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.ct-card h2 { font-size: 16px; font-weight: 750; margin: 0 0 16px; }

.ct-label { display: block; font-size: 13px; font-weight: 600; color: #374151; margin: 14px 0 6px; }
.ct-label:first-of-type { margin-top: 0; }
.ct-input, .ct-select, .ct-area { width: 100%; padding: 11px 12px; border: 1px solid #d8d8e0;
  border-radius: 10px; font-size: 14px; background: #fff; color: #1a1a2e; outline: none;
  font-family: inherit; box-sizing: border-box; }
.ct-input:focus, .ct-select:focus, .ct-area:focus { border-color: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,.15); }
.ct-area { resize: vertical; min-height: 130px; line-height: 1.5; }
.ct-submit { margin-top: 18px; width: 100%; border: 0; border-radius: 12px; padding: 13px;
  font-size: 15px; font-weight: 700; cursor: pointer; color: #fff;
  background: linear-gradient(135deg, #1a73e8, #4285f4); transition: opacity .15s; }
.ct-submit:hover { opacity: .9; }
.ct-submit:disabled { opacity: .6; cursor: default; }

.ct-ok { background: #dcfce7; border: 1px solid #bbf7d0; color: #15803d; border-radius: 14px;
  padding: 16px 18px; font-size: 14px; font-weight: 600; }
.ct-err { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 12px;
  padding: 12px 14px; font-size: 13.5px; margin-bottom: 16px; }

.ct-side .row { display: flex; gap: 12px; align-items: flex-start; padding: 14px 0; border-top: 1px solid #f1f1f4; }
.ct-side .row:first-child { border-top: 0; padding-top: 0; }
.ct-side .ic { flex: 0 0 40px; width: 40px; height: 40px; border-radius: 12px; display: flex;
  align-items: center; justify-content: center; font-size: 19px; background: linear-gradient(135deg, #e8f0fe, #eaf1fd); }
.ct-side .rt { font-size: 14px; font-weight: 700; margin-bottom: 2px; }
.ct-side .rd { font-size: 13px; color: #6b7280; line-height: 1.5; }
.ct-side .rd a { color: #1a73e8; font-weight: 600; text-decoration: none; }
.ct-side .rd a:hover { text-decoration: underline; }
.ct-chip { display: inline-flex; align-items: center; gap: 6px; background: #f0fdf4; color: #15803d;
  border: 1px solid #bbf7d0; padding: 5px 11px; border-radius: 999px; font-size: 12px; font-weight: 700; margin-top: 4px; }

@media (max-width: 720px) { .ct-cols { grid-template-columns: 1fr; } }
`;

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

      <style>{CSS}</style>

      <div className="ct-wrap">
        <div className="ct-hero">
          <h1>Estamos para ayudarte 💬</h1>
          <p>
            ¿Tienes una duda, un problema o una idea para mejorar la app?
            Escríbenos y te respondemos lo antes posible.
          </p>
        </div>

        <div className="ct-cols">
          {/* Formulario */}
          <div className="ct-card">
            <h2>Envíanos un mensaje</h2>

            {enviado ? (
              <div className="ct-ok">
                ✅ ¡Gracias! Recibimos tu mensaje y te responderemos a tu correo
                pronto.
              </div>
            ) : (
              <>
                {fetcher.data?.error ? (
                  <div className="ct-err">{fetcher.data.error}</div>
                ) : null}

                <label className="ct-label">Tu correo (para responderte)</label>
                <input
                  className="ct-input"
                  type="email"
                  placeholder="tucorreo@ejemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />

                <label className="ct-label">Asunto</label>
                <select
                  className="ct-select"
                  value={asunto}
                  onChange={(e) => setAsunto(e.target.value)}
                >
                  {ASUNTOS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>

                <label className="ct-label">Mensaje</label>
                <textarea
                  className="ct-area"
                  placeholder="Cuéntanos en qué te podemos ayudar…"
                  value={mensaje}
                  onChange={(e) => setMensaje(e.target.value)}
                />

                <button
                  className="ct-submit"
                  onClick={enviar}
                  disabled={enviando}
                >
                  {enviando ? "Enviando…" : "Enviar mensaje"}
                </button>
              </>
            )}
          </div>

          {/* Datos de contacto directo */}
          <div className="ct-card ct-side">
            <h2>Otras formas de contacto</h2>
            <div className="row">
              <div className="ic">✉️</div>
              <div>
                <div className="rt">Email de soporte</div>
                <div className="rd">
                  <a
                    href={`mailto:${SOPORTE_EMAIL}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {SOPORTE_EMAIL}
                  </a>
                </div>
              </div>
            </div>
            <div className="row">
              <div className="ic">⏱️</div>
              <div>
                <div className="rt">Tiempo de respuesta</div>
                <div className="rd">
                  Respondemos en menos de 24 horas hábiles.
                  <br />
                  <span className="ct-chip">● Soporte en español</span>
                </div>
              </div>
            </div>
            <div className="row">
              <div className="ic">🇲🇽</div>
              <div>
                <div className="rt">Hecho para México</div>
                <div className="rd">
                  Cotizaciones B2B, crédito (Net 30/60) y facturación CFDI
                  pensados para tu negocio.
                </div>
              </div>
            </div>
            {shopName ? (
              <div className="row">
                <div className="ic">🏪</div>
                <div>
                  <div className="rt">Tu tienda</div>
                  <div className="rd">{shopName}</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
