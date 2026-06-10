import { useEffect, useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { PLANES_PRO } from "../plans";
import {
  mergeFormulario,
  DEFAULT_FORMULARIO,
  type FormularioConfig,
} from "../formulario-config";
import {
  construirPreviewFormulario,
  type PasoPreview,
} from "../formulario-preview";

// La personalización del formulario vive en el MISMO metafield JSON de la app
// (`$app:flouvia`/`config`), bajo la llave `formulario`. Esta ruta solo edita esa
// llave: lee la config completa, reemplaza `formulario` y guarda todo de vuelta
// (sin pisar fiscal/correos/pdf/etc. que edita la pestaña de Configuración).
const NS = "$app:flouvia";
const KEY = "config";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const resp = await admin.graphql(
    `#graphql
      query cargarFormulario {
        currentAppInstallation {
          activeSubscriptions { name status }
        }
        shop {
          name
          metafield(namespace: "${NS}", key: "${KEY}") { value }
        }
      }`,
  );
  const json: any = await resp.json();
  const shop = json.data?.shop ?? {};

  const subs = json.data?.currentAppInstallation?.activeSubscriptions ?? [];
  const hasPro = subs.some(
    (s: any) => PLANES_PRO.includes(s.name) && s.status === "ACTIVE",
  );

  let guardado: any = null;
  try {
    if (shop.metafield?.value) guardado = JSON.parse(shop.metafield.value);
  } catch {
    // valor corrupto: usamos defaults
  }

  return {
    formulario: mergeFormulario(guardado?.formulario),
    shopName: shop.name ?? "",
    hasPro,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  let entrante: any;
  try {
    entrante = JSON.parse(String(formData.get("formulario") ?? "{}"));
  } catch {
    return { error: "No se pudo leer la configuración del formulario." };
  }
  const formulario = mergeFormulario(entrante);

  // Leemos la config completa actual + el ID de la tienda en una sola consulta,
  // para no pisar el resto de la configuración al guardar.
  const ctxResp = await admin.graphql(
    `#graphql
      query { shop { id metafield(namespace: "${NS}", key: "${KEY}") { value } } }`,
  );
  const ctxJson: any = await ctxResp.json();
  const ownerId = ctxJson.data?.shop?.id;
  if (!ownerId) {
    return { error: "No se pudo identificar la tienda." };
  }

  let actual: any = {};
  try {
    const v = ctxJson.data?.shop?.metafield?.value;
    if (v) actual = JSON.parse(v);
  } catch {
    actual = {};
  }
  const nuevaConfig = { ...actual, formulario };

  const resp = await admin.graphql(
    `#graphql
      mutation guardarFormulario($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId,
            namespace: NS,
            key: KEY,
            type: "json",
            value: JSON.stringify(nuevaConfig),
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

  return { ok: true, formulario };
};

const CSS = `
.ff-wrap { max-width: 1180px; margin: 0 auto; padding: 8px 16px 130px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; color: #1a1a2e; }

.ff-hero { position: relative; overflow: hidden; border-radius: 20px; padding: 26px 28px;
  background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff;
  box-shadow: 0 14px 34px -12px rgba(26,115,232,.5); margin: 8px 0 22px; }
.ff-hero::after { content: ""; position: absolute; top: -60px; right: -40px; width: 220px; height: 220px;
  background: rgba(255,255,255,.12); border-radius: 50%; }
.ff-hero h1 { font-size: 26px; font-weight: 800; margin: 0 0 6px; letter-spacing: -0.02em; position: relative; }
.ff-hero p { font-size: 15px; margin: 0; opacity: .92; position: relative; max-width: 600px; }
.ff-badge { display: inline-flex; align-items: center; gap: 5px; vertical-align: middle; margin-left: 10px;
  background: rgba(255,255,255,.22); color: #fff; font-size: 12px; font-weight: 800; padding: 3px 10px;
  border-radius: 999px; }

/* Layout editor + preview */
.ff-grid { display: grid; grid-template-columns: 1fr 1.05fr; gap: 24px; align-items: start; }
.ff-card { background: #fff; border: 1px solid #ececf0; border-radius: 18px; padding: 22px 24px;
  box-shadow: 0 4px 16px -8px rgba(20,20,40,.1); }
.ff-card h2 { font-size: 16px; font-weight: 800; margin: 0 0 4px; }
.ff-card .sub { font-size: 13px; color: #6b7280; margin: 0 0 16px; line-height: 1.5; }
.ff-sec { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em;
  color: #9099a8; margin: 22px 0 12px; padding-top: 18px; border-top: 1px solid #f1f1f4; }
.ff-sec:first-of-type { border-top: 0; padding-top: 0; margin-top: 6px; }

.ff-field { display: flex; flex-direction: column; margin-bottom: 14px; }
.ff-label { font-size: 12.5px; font-weight: 700; color: #374151; margin-bottom: 6px; }
.ff-hint { font-size: 11.5px; color: #9099a8; margin-bottom: 6px; }
.ff-input { width: 100%; padding: 10px 12px; border: 1px solid #d8d8e0; border-radius: 10px;
  font-size: 14px; font-family: inherit; color: #1a1a2e; background: #fff; outline: none; box-sizing: border-box; }
.ff-input:focus { border-color: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,.15); }
textarea.ff-input { resize: vertical; min-height: 70px; line-height: 1.5; }
.ff-count { font-size: 11px; color: #9099a8; margin-top: 4px; text-align: right; }

.ff-color-row { display: flex; gap: 10px; align-items: center; }
.ff-color { width: 50px; height: 42px; padding: 0; border: 1px solid #d8d8e0; border-radius: 10px; background: #fff; cursor: pointer; }

.ff-restore { margin-top: 6px; border: 1px solid #e2e2ea; background: #fff; border-radius: 10px;
  padding: 9px 14px; font-size: 13px; font-weight: 600; color: #6b7280; cursor: pointer; }
.ff-restore:hover { border-color: #f0c0c0; color: #c0392b; }

/* Preview */
.ff-preview { position: sticky; top: 12px; }
.ff-plabel { font-size: 11.5px; font-weight: 700; color: #9099a8; text-transform: uppercase;
  letter-spacing: .05em; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.ff-dot { width: 8px; height: 8px; border-radius: 999px; background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.18); }
.ff-steps { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
.ff-step { border: 1px solid #e2e2ea; background: #fff; border-radius: 999px; padding: 6px 14px;
  font-size: 12.5px; font-weight: 700; color: #6b7280; cursor: pointer; transition: all .15s; }
.ff-step:hover { border-color: #cfe0fc; color: #1a56c4; }
.ff-step.on { background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff; border-color: transparent;
  box-shadow: 0 6px 14px -6px rgba(26,115,232,.6); }

.ff-frame-wrap { border: 1px solid #e2e6ee; border-radius: 18px; overflow: hidden; background: #f1f2f5;
  box-shadow: 0 18px 50px -24px rgba(20,20,40,.45); }
.ff-iframe { width: 100%; height: 660px; border: 0; display: block; }
.ff-tip { font-size: 12px; color: #9099a8; margin-top: 10px; line-height: 1.5; }

/* Candado Pro */
.ff-lock { text-align: center; padding: 54px 24px; }
.ff-lock .ic { font-size: 46px; margin-bottom: 12px; }
.ff-lock h3 { font-size: 21px; font-weight: 800; margin: 0 0 10px; }
.ff-lock p { font-size: 14.5px; color: #6b7280; line-height: 1.6; max-width: 480px; margin: 0 auto 22px; }
.ff-lock .go { display: inline-block; background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff;
  text-decoration: none; border-radius: 12px; padding: 12px 26px; font-size: 15px; font-weight: 700;
  box-shadow: 0 12px 28px -10px rgba(26,115,232,.6); }

/* Barra de guardado flotante */
.ff-savebar { position: fixed; left: 50%; bottom: 22px; transform: translate(-50%, 140%);
  display: flex; align-items: center; gap: 16px; background: #16161a; color: #fff; padding: 12px 16px 12px 20px;
  border-radius: 14px; box-shadow: 0 18px 44px -14px rgba(0,0,0,.55); transition: transform .25s cubic-bezier(.2,.9,.3,1);
  z-index: 50; }
.ff-savebar.show { transform: translate(-50%, 0); }
.ff-savebar .msg { font-size: 13.5px; font-weight: 600; }
.ff-savebar .acts { display: flex; gap: 9px; }
.ff-sb-btn { border: 0; border-radius: 10px; padding: 9px 16px; font-size: 13.5px; font-weight: 700; cursor: pointer; }
.ff-sb-btn.discard { background: rgba(255,255,255,.12); color: #fff; }
.ff-sb-btn.save { background: #1a73e8; color: #fff; }
.ff-sb-btn:disabled { opacity: .55; cursor: not-allowed; }

@media (max-width: 940px) {
  .ff-grid { grid-template-columns: 1fr; }
  .ff-preview { position: static; }
}
`;

export default function FormularioTienda() {
  const { formulario: inicial, hasPro } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  const [guardado, setGuardado] = useState<FormularioConfig>(inicial);
  const [form, setForm] = useState<FormularioConfig>(inicial);
  const [paso, setPaso] = useState<PasoPreview>(1);

  const guardando = fetcher.state !== "idle";
  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(guardado),
    [form, guardado],
  );

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.formulario) {
      setGuardado(fetcher.data.formulario);
      setForm(fetcher.data.formulario);
      shopify.toast.show("Formulario guardado ✅");
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const setTexto = (parche: Partial<FormularioConfig["textos"]>) =>
    setForm((f) => ({ ...f, textos: { ...f.textos, ...parche } }));
  const setApar = (parche: Partial<FormularioConfig["apariencia"]>) =>
    setForm((f) => ({ ...f, apariencia: { ...f.apariencia, ...parche } }));

  const preview = useMemo(
    () => construirPreviewFormulario(form, { pro: true, paso }),
    [form, paso],
  );

  const PASOS: { id: PasoPreview; label: string }[] = [
    { id: 1, label: "1 · Productos" },
    { id: 2, label: "2 · Contacto" },
    { id: 3, label: "3 · Revisar" },
    { id: "ok", label: "✓ Éxito" },
  ];

  const guardar = () =>
    fetcher.submit(
      { formulario: JSON.stringify(form) },
      { method: "post" },
    );
  const descartar = () => setForm(guardado);

  return (
    <s-page heading="Formulario de la tienda">
      <s-button
        slot="breadcrumbs"
        variant="tertiary"
        href="/app"
        icon="arrow-left"
      >
        Inicio
      </s-button>

      <style>{CSS}</style>

      <div className="ff-wrap">
        <div className="ff-hero">
          <h1>
            Formulario de cotización 🎨
            <span className="ff-badge">PRO</span>
          </h1>
          <p>
            Personaliza la ventana de cotización que tus clientes ven en la
            tienda. Lo que cambies aquí manda sobre el editor de temas, y lo ves
            al instante en la vista previa de la derecha.
          </p>
        </div>

        {!hasPro ? (
          <div className="ff-card">
            <div className="ff-lock">
              <div className="ic">🔒</div>
              <h3>Disponible en el Plan Pro</h3>
              <p>
                Con el Plan Pro personalizas desde aquí los textos y la
                apariencia del formulario de cotización, sin tocar el código del
                tema. Mientras tanto, puedes seguir personalizándolo desde el
                editor de temas de tu tienda.
              </p>
              <a className="go" href="/app/plans">
                Ver Plan Pro →
              </a>
            </div>
          </div>
        ) : (
          <div className="ff-grid">
            {/* ---------- Editor ---------- */}
            <div className="ff-card">
              <h2>Textos y apariencia</h2>
              <p className="sub">
                Ajusta cada texto y color. La vista previa se actualiza mientras
                escribes.
              </p>

              <div className="ff-sec">📝 Textos de la ventana</div>

              <div className="ff-field">
                <label className="ff-label">Título de la ventana</label>
                <input
                  className="ff-input"
                  placeholder="Solicitar cotización"
                  maxLength={60}
                  value={form.textos.tituloModal}
                  onChange={(e) => setTexto({ tituloModal: e.target.value })}
                />
                <span className="ff-count">
                  {form.textos.tituloModal.length}/60
                </span>
              </div>

              <div className="ff-field">
                <label className="ff-label">Paso 1 · Productos</label>
                <span className="ff-hint">
                  El texto de introducción del primer paso.
                </span>
                <input
                  className="ff-input"
                  value={form.textos.leadPaso1}
                  onChange={(e) => setTexto({ leadPaso1: e.target.value })}
                />
              </div>

              <div className="ff-field">
                <label className="ff-label">Paso 2 · Contacto</label>
                <span className="ff-hint">
                  La pregunta que invita a dejar sus datos.
                </span>
                <input
                  className="ff-input"
                  value={form.textos.leadPaso2}
                  onChange={(e) => setTexto({ leadPaso2: e.target.value })}
                />
              </div>

              <div className="ff-field">
                <label className="ff-label">Paso 3 · Revisar</label>
                <input
                  className="ff-input"
                  value={form.textos.leadPaso3}
                  onChange={(e) => setTexto({ leadPaso3: e.target.value })}
                />
              </div>

              <div className="ff-field">
                <label className="ff-label">Mensaje de éxito</label>
                <span className="ff-hint">
                  Lo que ve el cliente al enviar su solicitud.
                </span>
                <textarea
                  className="ff-input"
                  value={form.textos.mensajeExito}
                  onChange={(e) => setTexto({ mensajeExito: e.target.value })}
                />
              </div>

              <div className="ff-sec">🎨 Apariencia</div>

              <div className="ff-field">
                <label className="ff-label">Texto del botón</label>
                <input
                  className="ff-input"
                  placeholder="Solicitar cotización"
                  maxLength={40}
                  value={form.apariencia.textoBoton}
                  onChange={(e) => setApar({ textoBoton: e.target.value })}
                />
              </div>

              <div className="ff-field">
                <label className="ff-label">Color de acento de la ventana</label>
                <span className="ff-hint">
                  Encabezado, pasos y botones del modal.
                </span>
                <div className="ff-color-row">
                  <input
                    type="color"
                    className="ff-color"
                    value={form.apariencia.colorAcento}
                    onChange={(e) => setApar({ colorAcento: e.target.value })}
                  />
                  <input
                    className="ff-input"
                    value={form.apariencia.colorAcento}
                    onChange={(e) => setApar({ colorAcento: e.target.value })}
                    style={{ maxWidth: 140 }}
                  />
                </div>
              </div>

              <div className="ff-field">
                <label className="ff-label">Fondo del botón</label>
                <div className="ff-color-row">
                  <input
                    type="color"
                    className="ff-color"
                    value={form.apariencia.botonBg}
                    onChange={(e) => setApar({ botonBg: e.target.value })}
                  />
                  <input
                    className="ff-input"
                    value={form.apariencia.botonBg}
                    onChange={(e) => setApar({ botonBg: e.target.value })}
                    style={{ maxWidth: 140 }}
                  />
                </div>
              </div>

              <div className="ff-field">
                <label className="ff-label">Color del texto del botón</label>
                <div className="ff-color-row">
                  <input
                    type="color"
                    className="ff-color"
                    value={form.apariencia.botonTextoColor}
                    onChange={(e) =>
                      setApar({ botonTextoColor: e.target.value })
                    }
                  />
                  <input
                    className="ff-input"
                    value={form.apariencia.botonTextoColor}
                    onChange={(e) =>
                      setApar({ botonTextoColor: e.target.value })
                    }
                    style={{ maxWidth: 140 }}
                  />
                </div>
              </div>

              <button
                className="ff-restore"
                onClick={() => setForm(DEFAULT_FORMULARIO)}
              >
                ↺ Restaurar valores por defecto
              </button>
            </div>

            {/* ---------- Preview fiel ---------- */}
            <div className="ff-preview">
              <div className="ff-plabel">
                <span className="ff-dot" />
                Vista previa · como se ve en tu tienda
              </div>
              <div className="ff-steps">
                {PASOS.map((p) => (
                  <button
                    key={String(p.id)}
                    className={`ff-step ${paso === p.id ? "on" : ""}`}
                    onClick={() => setPaso(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="ff-frame-wrap">
                <iframe
                  className="ff-iframe"
                  title="Vista previa del formulario"
                  srcDoc={preview}
                />
              </div>
              <p className="ff-tip">
                💡 Usa los botones de arriba para recorrer cada paso del modal,
                igual que lo verán tus clientes en la tienda.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Barra de guardado flotante */}
      <div className={`ff-savebar ${dirty ? "show" : ""}`}>
        <span className="msg">Tienes cambios sin guardar</span>
        <div className="acts">
          <button
            className="ff-sb-btn discard"
            onClick={descartar}
            disabled={guardando}
          >
            Descartar
          </button>
          <button
            className="ff-sb-btn save"
            onClick={guardar}
            disabled={guardando}
          >
            {guardando ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
