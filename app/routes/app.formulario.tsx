import { useEffect, useMemo, useRef, useState } from "react";
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

// Dimensiones de viewport real que simula cada modo — el iframe se renderiza
// a este tamaño nativo y se escala para caber en el panel (mismo truco que
// usan los builders tipo Webflow/editor de temas). Sin esto, "escritorio" y
// "móvil" solo cambiaban un poco el ancho del cuadro, nunca cruzaban el
// breakpoint real de la tienda y se veían prácticamente iguales.
const DISPOSITIVOS: Record<"desktop" | "mobile", { w: number; h: number; label: string }> = {
  desktop: { w: 980, h: 620, label: "Escritorio" },
  mobile: { w: 390, h: 700, label: "Móvil" },
};

export default function FormularioTienda() {
  const { formulario: inicial, hasPro } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  const [guardado, setGuardado] = useState<FormularioConfig>(inicial);
  const [form, setForm] = useState<FormularioConfig>(inicial);
  const [paso, setPaso] = useState<PasoPreview>(1);
  const [panel, setPanel] = useState<"contenido" | "apariencia">("contenido");
  const [dispositivo, setDispositivo] = useState<"desktop" | "mobile">("desktop");

  // Ancho real disponible para la vista previa (mide el contenedor, no la
  // ventana) — determina qué tanto hay que escalar el viewport simulado.
  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const [previewBoxWidth, setPreviewBoxWidth] = useState(0);
  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setPreviewBoxWidth(w);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [previewBoxRef]);

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

  const dims = DISPOSITIVOS[dispositivo];
  const escala = previewBoxWidth > 0 ? Math.min(1, previewBoxWidth / dims.w) : 1;

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
        <s-grid
          gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr)"
          gap="base"
        >
          {/* Panel de edición: dos botones de texto (mismo patrón que Pasos
              y Dispositivo, abajo) deciden cuál de los dos se muestra —
              antes era un rail de solo íconos y no se leía como botones. */}
          <s-stack gap="base">
            <s-stack direction="inline" gap="small-200">
              <s-button
                variant={panel === "contenido" ? "primary" : "secondary"}
                icon="forms"
                onClick={() => setPanel("contenido")}
              >
                Contenido
              </s-button>
              <s-button
                variant={panel === "apariencia" ? "primary" : "secondary"}
                icon="paint-brush-round"
                onClick={() => setPanel("apariencia")}
              >
                Apariencia
              </s-button>
            </s-stack>

          {panel === "contenido" ? (
            <s-section heading="Contenido">
              <s-stack gap="base">
                <s-paragraph color="subdued">
                  Personaliza los textos de la ventana de cotización. Lo que
                  cambies aquí manda sobre el editor de temas, y lo ves al
                  instante en la vista previa.
                </s-paragraph>
                <s-text-field
                  label="Título de la ventana"
                  placeholder="Solicitar cotización"
                  details={`${form.textos.tituloModal.length}/60 caracteres.`}
                  value={form.textos.tituloModal}
                  onChange={(e: any) =>
                    setTexto({ tituloModal: e.currentTarget.value.slice(0, 60) })
                  }
                />
                <s-divider />
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
                <s-divider />
                <s-text-area
                  label="Mensaje de éxito"
                  details="Lo que ve el cliente al enviar su solicitud."
                  rows={3}
                  value={form.textos.mensajeExito}
                  onChange={(e: any) =>
                    setTexto({ mensajeExito: e.currentTarget.value })
                  }
                />
              </s-stack>
            </s-section>
          ) : (
            <s-section heading="Apariencia">
              <s-stack gap="base">
                <s-paragraph color="subdued">
                  Colores y texto del botón que dispara el modal.
                </s-paragraph>
                <s-text-field
                  label="Texto del botón"
                  placeholder="Solicitar cotización"
                  value={form.apariencia.textoBoton}
                  onChange={(e: any) =>
                    setApar({ textoBoton: e.currentTarget.value.slice(0, 40) })
                  }
                />
                <s-divider />
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
          )}
          </s-stack>

          {/* Vista previa sticky con toggle de dispositivo (desktop/mobile),
              igual que el builder de las apps top del App Store. */}
          <div style={{ position: "sticky", top: 16, alignSelf: "start" }}>
            <s-section heading="Vista previa · como se ve en tu tienda">
              <s-stack gap="base">
                <s-stack
                  direction="inline"
                  justifyContent="space-between"
                  alignItems="center"
                  gap="small-200"
                >
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
                  <s-stack direction="inline" gap="small-100">
                    <s-button
                      variant={dispositivo === "desktop" ? "primary" : "secondary"}
                      icon="desktop"
                      onClick={() => setDispositivo("desktop")}
                    >
                      Escritorio
                    </s-button>
                    <s-button
                      variant={dispositivo === "mobile" ? "primary" : "secondary"}
                      icon="mobile"
                      onClick={() => setDispositivo("mobile")}
                    >
                      Móvil
                    </s-button>
                  </s-stack>
                </s-stack>
                <s-box
                  padding="base"
                  background="subdued"
                  borderRadius="base"
                >
                  {/* El iframe se renderiza a su tamaño real de viewport
                      (980px escritorio / 390px móvil) y se escala para caber
                      — así el HTML de adentro realmente cruza el breakpoint
                      responsive de la tienda (colapsa columnas, oculta
                      etiquetas de paso, etc.) en vez de solo verse "un poco
                      más angosto". */}
                  <div
                    ref={previewBoxRef}
                    style={{ width: "100%", display: "flex", justifyContent: "center" }}
                  >
                    <div
                      style={{
                        width: dims.w * escala,
                        height: dims.h * escala,
                        overflow: "hidden",
                        borderRadius: 8,
                        border: "1px solid #e3e3e3",
                        background: "#fff",
                        transition: "width 0.25s ease, height 0.25s ease",
                      }}
                    >
                      <iframe
                        title="Vista previa del formulario"
                        srcDoc={preview}
                        style={{
                          width: dims.w,
                          height: dims.h,
                          border: 0,
                          transform: `scale(${escala})`,
                          transformOrigin: "top left",
                        }}
                      />
                    </div>
                  </div>
                </s-box>
                <s-text color="subdued">
                  {`Simulando un viewport de ${dims.w}px (${dims.label.toLowerCase()}). Usa los botones de arriba para recorrer cada paso del modal, igual que lo verán tus clientes en la tienda.`}
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
