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

// Campo de color: campo de texto Polaris + selector de color nativo al lado.
function CampoColor(props: {
  label: string;
  details?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <s-stack direction="inline" gap="small-200" alignItems="end">
      <s-text-field
        label={props.label}
        details={props.details}
        value={props.value}
        onChange={(e: any) => props.onChange(e.currentTarget.value)}
      />
      <input
        type="color"
        aria-label={props.label}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        style={{
          width: 44,
          height: 34,
          border: 0,
          background: "none",
          padding: 0,
        }}
      />
    </s-stack>
  );
}

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

  // Save bar contextual de App Bridge (guía de diseño BFS).
  useEffect(() => {
    if (dirty) shopify.saveBar.show("formulario-save-bar");
    else shopify.saveBar.hide("formulario-save-bar");
  }, [dirty, shopify]);

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

      {!hasPro ? (
        <s-section heading="Formulario de cotización personalizable">
          <s-stack gap="small-200">
            <s-stack direction="inline">
              <s-badge icon="lock" tone="info">Plan Pro</s-badge>
            </s-stack>
            <s-paragraph color="subdued">
              Con el Plan Pro personalizas desde aquí los textos y la
              apariencia del formulario de cotización, sin tocar el código del
              tema. Mientras tanto, puedes seguir personalizándolo desde el
              editor de temas de tu tienda.
            </s-paragraph>
            <s-stack direction="inline">
              <s-button variant="primary" href="/app/plans">
                Ver Plan Pro
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      ) : (
        <s-grid gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr)" gap="base">
          {/* Columna izquierda: editor */}
          <s-section heading="Textos y apariencia">
            <s-stack gap="base">
              <s-paragraph color="subdued">
                Personaliza la ventana de cotización que tus clientes ven en la
                tienda. Lo que cambies aquí manda sobre el editor de temas, y
                lo ves al instante en la vista previa.
              </s-paragraph>

              <s-heading>Textos de la ventana</s-heading>
              <s-text-field
                label="Título de la ventana"
                placeholder="Solicitar cotización"
                details={`${form.textos.tituloModal.length}/60 caracteres.`}
                value={form.textos.tituloModal}
                onChange={(e: any) =>
                  setTexto({ tituloModal: e.currentTarget.value.slice(0, 60) })
                }
              />
              <s-text-field
                label="Paso 1 · Productos"
                details="El texto de introducción del primer paso."
                value={form.textos.leadPaso1}
                onChange={(e: any) =>
                  setTexto({ leadPaso1: e.currentTarget.value })
                }
              />
              <s-text-field
                label="Paso 2 · Contacto"
                details="La pregunta que invita a dejar sus datos."
                value={form.textos.leadPaso2}
                onChange={(e: any) =>
                  setTexto({ leadPaso2: e.currentTarget.value })
                }
              />
              <s-text-field
                label="Paso 3 · Revisar"
                value={form.textos.leadPaso3}
                onChange={(e: any) =>
                  setTexto({ leadPaso3: e.currentTarget.value })
                }
              />
              <s-text-area
                label="Mensaje de éxito"
                details="Lo que ve el cliente al enviar su solicitud."
                rows={3}
                value={form.textos.mensajeExito}
                onChange={(e: any) =>
                  setTexto({ mensajeExito: e.currentTarget.value })
                }
              />

              <s-heading>Apariencia</s-heading>
              <s-text-field
                label="Texto del botón"
                placeholder="Solicitar cotización"
                value={form.apariencia.textoBoton}
                onChange={(e: any) =>
                  setApar({ textoBoton: e.currentTarget.value.slice(0, 40) })
                }
              />
              <CampoColor
                label="Color de acento de la ventana"
                details="Encabezado, pasos y botones del modal."
                value={form.apariencia.colorAcento}
                onChange={(v) => setApar({ colorAcento: v })}
              />
              <CampoColor
                label="Fondo del botón"
                value={form.apariencia.botonBg}
                onChange={(v) => setApar({ botonBg: v })}
              />
              <CampoColor
                label="Color del texto del botón"
                value={form.apariencia.botonTextoColor}
                onChange={(v) => setApar({ botonTextoColor: v })}
              />

              <s-stack direction="inline">
                <s-button
                  variant="tertiary"
                  onClick={() => setForm(DEFAULT_FORMULARIO)}
                >
                  Restaurar valores por defecto
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>

          {/* Columna derecha: vista previa sticky (siempre visible mientras
              editas, como el builder de las apps top del App Store) */}
          <div style={{ position: "sticky", top: 16, alignSelf: "start" }}>
            <s-section heading="Vista previa · como se ve en tu tienda">
              <s-stack gap="base">
                <s-stack direction="inline" gap="small-200">
                  {PASOS.map((p) => (
                    <s-button
                      key={String(p.id)}
                      variant={paso === p.id ? "primary" : "secondary"}
                      onClick={() => setPaso(p.id)}
                    >
                      {p.label}
                    </s-button>
                  ))}
                </s-stack>
                <iframe
                  title="Vista previa del formulario"
                  srcDoc={preview}
                  style={{
                    width: "100%",
                    height: 600,
                    border: "1px solid #e3e3e3",
                    borderRadius: 8,
                    background: "#f1f2f5",
                  }}
                />
                <s-text color="subdued">
                  Usa los botones de arriba para recorrer cada paso del modal,
                  igual que lo verán tus clientes en la tienda.
                </s-text>
              </s-stack>
            </s-section>
          </div>
        </s-grid>
      )}

      {/* Save bar contextual de App Bridge (aparece cuando hay cambios). */}
      <ui-save-bar id="formulario-save-bar">
        <button
          {...({ variant: "primary" } as any)}
          onClick={guardar}
          disabled={guardando}
        ></button>
        <button onClick={descartar} disabled={guardando}></button>
      </ui-save-bar>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
