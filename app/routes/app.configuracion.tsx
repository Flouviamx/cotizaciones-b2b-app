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
import { TODOS_LOS_PLANES, PLANES_PRO } from "../plans";
import {
  construirCorreo,
  mergeEmails,
  tablaDatos,
  DEFAULTS_EMAILS,
  VARIABLES_POR_CORREO,
  ETIQUETAS_CORREO,
  type EmailsConfig,
  type EmailKey,
  type EmailTpl,
} from "../email-templates";
import {
  construirHTMLcotizacion,
  mergePdfMarca,
  DEFAULT_PDF,
  type PdfMarca,
} from "../pdf-cotizacion";
import {
  mergeFormulario,
  DEFAULT_FORMULARIO,
  type FormularioConfig,
} from "../formulario-config";
import {
  estadoEmisor,
  conectarEmisor,
  setLivemode,
  type OrgEstado,
} from "../facturapi.server";
import { NavVertical } from "../components/NavVertical";
import { Tabs } from "../components/Tabs";

// La configuración se guarda como UN metafield JSON propio de la app
// (namespace reservado "$app:flouvia"). Los metafields de la app no requieren
// el scope write_metafields ni tocar la base de datos.
const NS = "$app:flouvia";
const KEY = "config";

// Regímenes fiscales del SAT más comunes (clave + descripción).
const REGIMENES = [
  ["601", "General de Ley Personas Morales"],
  ["603", "Personas Morales con Fines no Lucrativos"],
  ["605", "Sueldos y Salarios e Ingresos Asimilados a Salarios"],
  ["606", "Arrendamiento"],
  ["612", "Personas Físicas con Actividades Empresariales y Profesionales"],
  ["616", "Sin obligaciones fiscales"],
  ["620", "Sociedades Cooperativas de Producción"],
  ["621", "Incorporación Fiscal"],
  ["622", "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras"],
  ["626", "Régimen Simplificado de Confianza (RESICO)"],
];

const TERMINOS_DISPONIBLES = ["Contado", "Net 15", "Net 30", "Net 60", "Net 90"];

type Config = {
  fiscal: {
    rfc: string;
    razonSocial: string;
    regimen: string;
    cp: string;
  };
  notificaciones: {
    email: string;
    avisarNuevaSolicitud: boolean;
  };
  credito: {
    terminos: string[];
    porDefecto: string;
  };
  boton: {
    texto: string;
    mostrarPrecio: boolean;
  };
  formulario: FormularioConfig;
  pdf: PdfMarca;
  emails: EmailsConfig;
};

const DEFAULTS: Config = {
  fiscal: { rfc: "", razonSocial: "", regimen: "601", cp: "" },
  notificaciones: { email: "", avisarNuevaSolicitud: true },
  credito: { terminos: ["Net 30", "Net 60"], porDefecto: "Net 30" },
  boton: { texto: "Solicitar cotización", mostrarPrecio: false },
  formulario: DEFAULT_FORMULARIO,
  pdf: DEFAULT_PDF,
  emails: DEFAULTS_EMAILS,
};

// Combina lo guardado con los defaults para que nunca falte una llave
// (aunque la config se haya guardado con una versión vieja de la app).
function mergeConfig(raw: any): Config {
  const c = raw && typeof raw === "object" ? raw : {};
  return {
    fiscal: { ...DEFAULTS.fiscal, ...(c.fiscal ?? {}) },
    notificaciones: { ...DEFAULTS.notificaciones, ...(c.notificaciones ?? {}) },
    credito: { ...DEFAULTS.credito, ...(c.credito ?? {}) },
    boton: { ...DEFAULTS.boton, ...(c.boton ?? {}) },
    formulario: mergeFormulario(c.formulario),
    pdf: mergePdfMarca(c.pdf),
    emails: mergeEmails(c.emails),
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const resp = await admin.graphql(
    `#graphql
      query cargarConfig {
        currentAppInstallation {
          activeSubscriptions { name status }
        }
        shop {
          name
          email
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
  const hasPaid = subs.some(
    (s: any) => TODOS_LOS_PLANES.includes(s.name) && s.status === "ACTIVE",
  );

  let guardado: any = null;
  try {
    if (shop.metafield?.value) guardado = JSON.parse(shop.metafield.value);
  } catch {
    // valor corrupto: usamos defaults
  }

  // Estado del emisor CFDI (organización Facturapi de esta tienda).
  const emisor = await estadoEmisor(session.shop);

  // Deep link al editor de temas con el panel de bloques de app ya abierto
  // (?context=apps) — usado en la pestaña "Botón en tienda" para "Modo solo
  // cotización" (esa función vive en el bloque Liquid, no en este metafield).
  const themeEditorUrl = `https://${session.shop}/admin/themes/current/editor?context=apps`;

  return {
    config: mergeConfig(guardado),
    shopName: shop.name ?? "",
    shopEmail: shop.email ?? "",
    hasPro,
    hasPaid,
    emisor,
    themeEditorUrl,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  // Candado Pro en el SERVIDOR para las acciones CFDI (la UI ya las bloquea,
  // pero el POST no se debe poder saltar). Igual que el loader, se calcula vía
  // activeSubscriptions (agnóstico a test/live).
  const esPro = async () => {
    const r = await admin.graphql(
      `#graphql
        query { currentAppInstallation { activeSubscriptions { name status } } }`,
    );
    const j: any = await r.json();
    const subs = j.data?.currentAppInstallation?.activeSubscriptions ?? [];
    return subs.some(
      (s: any) => PLANES_PRO.includes(s.name) && s.status === "ACTIVE",
    );
  };

  // ── CFDI: conectar el emisor (crear org + datos fiscales + subir CSD) ──
  if (intent === "cfdiConnect") {
    if (!(await esPro())) {
      return { cfdiError: "La facturación CFDI está disponible desde el Plan Pro." };
    }
    const cer = formData.get("cer");
    const key = formData.get("key");
    if (
      !(cer instanceof File) ||
      !(key instanceof File) ||
      cer.size === 0 ||
      key.size === 0
    ) {
      return { cfdiError: "Sube ambos archivos: el certificado (.cer) y la llave (.key)." };
    }
    const password = String(formData.get("password") ?? "");
    if (!password) {
      return { cfdiError: "Falta la contraseña de la llave privada (.key)." };
    }
    const legalName = String(formData.get("legalName") ?? "").trim();
    const taxSystem = String(formData.get("taxSystem") ?? "").trim();
    const zip = String(formData.get("zip") ?? "").trim();
    if (!legalName || !taxSystem || !zip) {
      return {
        cfdiError:
          "Captura primero tu razón social, régimen fiscal y código postal arriba.",
      };
    }
    const r = await conectarEmisor(session.shop, {
      legalName,
      taxSystem,
      zip,
      cer: new Uint8Array(await cer.arrayBuffer()),
      key: new Uint8Array(await key.arrayBuffer()),
      password,
    });
    if (!r.ok) return { cfdiError: r.error };
    return { cfdiOk: true, rfc: r.rfc };
  }

  // ── CFDI: alternar modo pruebas / producción ──
  if (intent === "cfdiLivemode") {
    if (!(await esPro())) {
      return { cfdiError: "La facturación CFDI está disponible desde el Plan Pro." };
    }
    const livemode = String(formData.get("livemode") ?? "") === "true";
    await setLivemode(session.shop, livemode);
    return { cfdiOk: true, livemode };
  }

  let entrante: any;
  try {
    entrante = JSON.parse(String(formData.get("config") ?? "{}"));
  } catch {
    return { error: "No se pudo leer la configuración." };
  }
  const config = mergeConfig(entrante);

  // Validación de RFC (sólo si el comerciante lo llenó). Persona moral = 12,
  // persona física = 13 caracteres.
  const rfc = config.fiscal.rfc.trim().toUpperCase();
  if (rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) {
    return { error: "El RFC no tiene un formato válido." };
  }
  config.fiscal.rfc = rfc;

  // Necesitamos el ID de la tienda (dueño del metafield).
  const shopResp = await admin.graphql(
    `#graphql
      query { shop { id } }`,
  );
  const shopJson: any = await shopResp.json();
  const ownerId = shopJson.data?.shop?.id;
  if (!ownerId) {
    return { error: "No se pudo identificar la tienda." };
  }

  const resp = await admin.graphql(
    `#graphql
      mutation guardarConfig($metafields: [MetafieldsSetInput!]!) {
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
            value: JSON.stringify(config),
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

  return { ok: true, config };
};


type TabId =
  | "fiscal"
  | "notificaciones"
  | "correos"
  | "credito"
  | "boton"
  | "pdf";
const TABS: { id: TabId; label: string; dePago?: boolean }[] = [
  { id: "fiscal", label: "Datos fiscales" },
  { id: "notificaciones", label: "Notificaciones" },
  { id: "correos", label: "Correos", dePago: true },
  { id: "credito", label: "Crédito", dePago: true },
  { id: "boton", label: "Botón en tienda" },
  { id: "pdf", label: "PDF", dePago: true },
];

function rfcEstado(rfc: string): "vacio" | "ok" | "mal" {
  const v = rfc.trim().toUpperCase();
  if (!v) return "vacio";
  return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(v) ? "ok" : "mal";
}

export default function Configuracion() {
  const {
    config: inicial,
    shopEmail,
    shopName,
    hasPaid,
    hasPro,
    emisor,
    themeEditorUrl,
  } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const cfdiFetcher = useFetcher<typeof action>();
  const [mostrarCsd, setMostrarCsd] = useState(false);

  const [tab, setTab] = useState<TabId>("fiscal");
  const [botonTab, setBotonTab] = useState<"texto" | "solo-cotizacion">("texto");
  const [mailSel, setMailSel] = useState<EmailKey>("clienteRecibido");
  // Los campos son web components de Polaris: el elemento host expone value/
  // focus, pero puede no soportar selección de texto (hay fallback al final).
  const asuntoRef = useRef<any>(null);
  const encabezadoRef = useRef<any>(null);
  const mensajeRef = useRef<any>(null);
  const ultimoCampo = useRef<"asunto" | "encabezado" | "mensaje">("mensaje");
  // "guardado" = la última versión confirmada en el servidor (para detectar cambios).
  const [guardado, setGuardado] = useState<Config>(inicial);
  const [config, setConfig] = useState<Config>(inicial);

  const guardando = fetcher.state !== "idle";
  const dirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(guardado),
    [config, guardado],
  );

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.config) {
      setGuardado(fetcher.data.config);
      setConfig(fetcher.data.config);
      shopify.toast.show("Configuración guardada ✅");
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  // Respuestas del flujo CFDI (conectar emisor / cambiar modo).
  useEffect(() => {
    const d = cfdiFetcher.data;
    if (d?.cfdiOk) {
      if (d.rfc) {
        shopify.toast.show(`Emisor conectado · RFC ${d.rfc} ✅`);
        setMostrarCsd(false);
      } else {
        shopify.toast.show("Listo ✅");
      }
    } else if (d?.cfdiError) {
      shopify.toast.show(d.cfdiError, { isError: true });
    }
  }, [cfdiFetcher.data, shopify]);

  const conectandoCfdi = cfdiFetcher.state !== "idle";

  // Helpers para actualizar una sección sin pisar el resto.
  const set = <K extends keyof Config>(seccion: K, parche: Partial<Config[K]>) =>
    setConfig((c) => ({ ...c, [seccion]: { ...c[seccion], ...parche } }));

  // Edita un campo de la plantilla de correo seleccionada.
  const setEmail = (key: EmailKey, parche: Partial<EmailTpl>) =>
    setConfig((c) => ({
      ...c,
      emails: { ...c.emails, [key]: { ...c.emails[key], ...parche } },
    }));

  // Inserta una variable {{...}} en la posición del cursor del último campo usado.
  const insertarVar = (token: string) => {
    const campo = ultimoCampo.current;
    const el =
      campo === "asunto"
        ? asuntoRef.current
        : campo === "encabezado"
          ? encabezadoRef.current
          : mensajeRef.current;
    const actual = config.emails[mailSel][campo];
    const ini = el?.selectionStart ?? actual.length;
    const fin = el?.selectionEnd ?? actual.length;
    const nuevo = actual.slice(0, ini) + token + actual.slice(fin);
    setEmail(mailSel, { [campo]: nuevo } as Partial<EmailTpl>);
    requestAnimationFrame(() => {
      if (el) {
        const pos = ini + token.length;
        el.focus();
        try {
          el.setSelectionRange(pos, pos);
        } catch {
          /* algunos inputs no soportan setSelectionRange */
        }
      }
    });
  };

  const restaurarDefault = () => setEmail(mailSel, DEFAULTS_EMAILS[mailSel]);

  // Preview en vivo: usa el MISMO render que el correo real, con datos de ejemplo.
  const tiendaDemo = shopName || "Tu tienda";
  const preview = useMemo(() => {
    const vars = {
      cliente: "María González",
      tienda: tiendaDemo,
      folio: "#D001",
      total: "$12,500.00 MXN",
    };
    const extraHtml =
      mailSel === "adminNueva"
        ? tablaDatos([
            { etiqueta: "Solicitante", valor: "María González" },
            { etiqueta: "Correo", valor: "maria@empresa.com" },
            { etiqueta: "Teléfono", valor: "55 1234 5678" },
            { etiqueta: "Empresa", valor: "Distribuidora ACME SA de CV" },
            { etiqueta: "RFC", valor: "ACM010101AB1" },
            { etiqueta: "Términos solicitados", valor: "Net 30" },
          ])
        : undefined;
    const cta =
      mailSel === "clienteCotizacion"
        ? { texto: "Ver y pagar mi cotización", url: "#" }
        : undefined;
    return construirCorreo({
      tpl: config.emails[mailSel],
      vars,
      tienda: tiendaDemo,
      cta,
      extraHtml,
    });
  }, [config.emails, mailSel, tiendaDemo]);

  // --- Helpers de la pestaña PDF (objeto anidado pdf.empresa / pdf.pie) ---
  const setPdf = (parche: Partial<Config["pdf"]>) => set("pdf", parche);
  const setPdfEmpresa = (parche: Partial<Config["pdf"]["empresa"]>) =>
    setConfig((c) => ({
      ...c,
      pdf: { ...c.pdf, empresa: { ...c.pdf.empresa, ...parche } },
    }));
  const setPdfPie = (parche: Partial<Config["pdf"]["pie"]>) =>
    setConfig((c) => ({
      ...c,
      pdf: { ...c.pdf, pie: { ...c.pdf.pie, ...parche } },
    }));

  // Subir logo: lo guardamos como data URL dentro de la config (sin hosting
  // externo ni scope extra). Tope ~250 KB para no inflar el metafield.
  const onLogo = (file?: File) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      shopify.toast.show("El archivo debe ser una imagen (PNG o JPG).", {
        isError: true,
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      if (url.length > 350000) {
        shopify.toast.show(
          "El logo pesa demasiado. Usa una imagen más pequeña (menos de 250 KB).",
          { isError: true },
        );
        return;
      }
      setPdf({ logo: url });
    };
    reader.readAsDataURL(file);
  };

  // Preview en vivo del PDF con datos de ejemplo y la marca actual.
  const pdfPreview = useMemo(
    () =>
      construirHTMLcotizacion({
        folio: "#D001",
        shopName: shopName || "Tu tienda",
        fecha: "9 de junio de 2026",
        clienteNombre: "María González",
        clienteEmail: "maria@empresa.com",
        items: [
          { title: "Producto de ejemplo A", quantity: 10, price: 850 },
          { title: "Producto de ejemplo B", quantity: 3, price: 1250 },
        ],
        moneda: "MXN",
        discountPct: 10,
        terminos: "Net 30",
        rfc: config.fiscal.rfc || "ACM010101AB1",
        razonSocial: config.fiscal.razonSocial || "Distribuidora ACME SA de CV",
        marca: config.pdf,
      }),
    [config.pdf, config.fiscal.rfc, config.fiscal.razonSocial, shopName],
  );

  const guardar = () => {
    const rfcSt = rfcEstado(config.fiscal.rfc);
    if (rfcSt === "mal") {
      setTab("fiscal");
      shopify.toast.show("Revisa el RFC: el formato no es válido.", {
        isError: true,
      });
      return;
    }
    fetcher.submit(
      { config: JSON.stringify(config) },
      { method: "POST" },
    );
  };

  const descartar = () => setConfig(guardado);

  // Tarjeta de candado para las pestañas de pago en el Plan Gratis.
  const lockCard = (titulo: string, desc: string) => (
    <s-section heading={titulo}>
      <s-stack gap="small-200">
        <s-stack direction="inline">
          <s-badge icon="lock" tone="info">Plan Básico</s-badge>
        </s-stack>
        <s-paragraph color="subdued">{desc}</s-paragraph>
        <s-stack direction="inline">
          <s-button variant="primary" href="/app/plans">Ver planes</s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );

  const rfcSt = rfcEstado(config.fiscal.rfc);

  // Mantiene coherente el término "por defecto": si lo quitan de los activos,
  // se reasigna al primero disponible.
  const toggleTermino = (t: string) => {
    setConfig((c) => {
      const activos = c.credito.terminos.includes(t)
        ? c.credito.terminos.filter((x) => x !== t)
        : [...c.credito.terminos, t];
      const orden = TERMINOS_DISPONIBLES.filter((x) => activos.includes(x));
      const porDefecto = orden.includes(c.credito.porDefecto)
        ? c.credito.porDefecto
        : (orden[0] ?? "");
      return { ...c, credito: { terminos: orden, porDefecto } };
    });
  };

  // Save bar contextual de App Bridge (guía de diseño BFS): aparece sola
  // cuando hay cambios sin guardar y se oculta al guardar/descartar.
  useEffect(() => {
    if (dirty) shopify.saveBar.show("config-save-bar");
    else shopify.saveBar.hide("config-save-bar");
  }, [dirty, shopify]);

  return (
    <s-page heading="Configuración">
      <s-button
        slot="breadcrumbs"
        variant="tertiary"
        href="/app"
        icon="arrow-left"
      >
        Inicio
      </s-button>

      {/* Hub de 2 columnas estilo admin: nav vertical (sticky) a la izquierda
          + panel de detalle a la derecha. Correos, Crédito y PDF son de pago
          (Plan Básico): se ven siempre, con candado en el Plan Gratis. */}
      <s-grid gridTemplateColumns="220px minmax(0, 1fr)" gap="base">
        <div style={{ position: "sticky", top: 16, alignSelf: "start" }}>
          <NavVertical
            items={TABS.map((t) => ({
              id: t.id,
              label: t.label,
              badge: t.dePago && !hasPaid ? "🔒" : undefined,
            }))}
            value={tab}
            onChange={setTab}
          />
        </div>

        <s-stack gap="base">
      {/* ---------- FISCAL ---------- */}
      {tab === "fiscal" ? (
        <>
          <s-section heading="Datos fiscales del emisor">
            <s-stack gap="base">
              <s-paragraph color="subdued">
                Se usan para timbrar tus facturas CFDI 4.0 al cerrar una
                cotización. Captúralos tal como están dados de alta en el SAT.
              </s-paragraph>
              <s-grid
                gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))"
                gap="base"
              >
                <s-text-field
                  label="RFC"
                  placeholder="XAXX010101000"
                  value={config.fiscal.rfc}
                  error={
                    rfcSt === "mal"
                      ? "El formato no es válido (12 o 13 caracteres)."
                      : undefined
                  }
                  details={
                    rfcSt === "ok"
                      ? "✓ RFC válido"
                      : "Persona moral 12 · física 13."
                  }
                  onChange={(e: any) =>
                    set("fiscal", {
                      rfc: e.currentTarget.value.toUpperCase().slice(0, 13),
                    })
                  }
                />
                <s-select
                  label="Régimen fiscal"
                  value={config.fiscal.regimen}
                  onChange={(e: any) =>
                    set("fiscal", { regimen: e.currentTarget.value })
                  }
                >
                  {REGIMENES.map(([clave, desc]) => (
                    <s-option key={clave} value={clave}>
                      {clave} — {desc}
                    </s-option>
                  ))}
                </s-select>
                <s-text-field
                  label="Razón social"
                  placeholder="Mi Empresa SA de CV"
                  value={config.fiscal.razonSocial}
                  onChange={(e: any) =>
                    set("fiscal", { razonSocial: e.currentTarget.value })
                  }
                />
                <s-text-field
                  label="Código postal (lugar de expedición)"
                  placeholder="06700"
                  details="CP de tu domicilio fiscal."
                  value={config.fiscal.cp}
                  onChange={(e: any) =>
                    set("fiscal", {
                      cp: e.currentTarget.value.replace(/\D/g, "").slice(0, 5),
                    })
                  }
                />
              </s-grid>
            </s-stack>
          </s-section>

          {/* ---------- Conexión CFDI (Facturapi) ---------- */}
          {!hasPro ? (
            <s-section heading="Facturación CFDI">
              <s-stack gap="small-200">
                <s-stack direction="inline">
                  <s-badge icon="lock" tone="info">Plan Pro</s-badge>
                </s-stack>
                <s-paragraph color="subdued">
                  Conecta tu certificado del SAT (CSD) y timbra facturas CFDI
                  4.0 automáticamente al cerrar una cotización. Disponible
                  desde el Plan Pro.
                </s-paragraph>
                <s-stack direction="inline">
                  <s-button variant="primary" href="/app/plans">
                    Ver planes Pro
                  </s-button>
                </s-stack>
              </s-stack>
            </s-section>
          ) : (
            <s-section heading="Conectar facturación CFDI">
              <s-stack gap="base">
                <s-paragraph color="subdued">
                  Sube tu Certificado de Sello Digital (CSD) del SAT para
                  timbrar facturas a nombre de tu empresa. El RFC se toma del
                  propio certificado.
                </s-paragraph>

                {emisor.certUploaded && !mostrarCsd ? (
                  <>
                    <s-banner
                      tone="success"
                      heading={`Emisor conectado${emisor.rfc ? ` · RFC ${emisor.rfc}` : ""}`}
                    >
                      <s-paragraph>
                        {emisor.livemode
                          ? "Modo Real: las facturas se timbran ante el SAT y son válidas."
                          : "Modo Pruebas: timbra facturas de prueba (no fiscales) para validar el flujo."}
                      </s-paragraph>
                    </s-banner>
                    <s-switch
                      label="Modo Real (facturas válidas ante el SAT)"
                      details="Apagado = modo Pruebas: las facturas no son fiscales."
                      checked={emisor.livemode}
                      disabled={conectandoCfdi}
                      onChange={() =>
                        cfdiFetcher.submit(
                          {
                            intent: "cfdiLivemode",
                            livemode: String(!emisor.livemode),
                          },
                          { method: "post" },
                        )
                      }
                    />
                    <s-stack direction="inline">
                      <s-button onClick={() => setMostrarCsd(true)}>
                        Actualizar certificado
                      </s-button>
                    </s-stack>
                  </>
                ) : (
                  <cfdiFetcher.Form method="post" encType="multipart/form-data">
                    <input type="hidden" name="intent" value="cfdiConnect" />
                    <input
                      type="hidden"
                      name="legalName"
                      value={config.fiscal.razonSocial}
                    />
                    <input
                      type="hidden"
                      name="taxSystem"
                      value={config.fiscal.regimen}
                    />
                    <input type="hidden" name="zip" value={config.fiscal.cp} />

                    <s-stack gap="base">
                      {!config.fiscal.razonSocial || !config.fiscal.cp ? (
                        <s-banner tone="warning" heading="Faltan datos fiscales">
                          <s-paragraph>
                            Completa tu razón social y código postal arriba
                            antes de conectar.
                          </s-paragraph>
                        </s-banner>
                      ) : null}

                      <s-grid
                        gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))"
                        gap="base"
                      >
                        <s-stack gap="small-300">
                          <s-text>Certificado (.cer)</s-text>
                          <input type="file" name="cer" accept=".cer" required />
                        </s-stack>
                        <s-stack gap="small-300">
                          <s-text>Llave privada (.key)</s-text>
                          <input type="file" name="key" accept=".key" required />
                        </s-stack>
                      </s-grid>
                      <s-password-field
                        label="Contraseña de la llave (.key)"
                        name="password"
                        placeholder="Contraseña del CSD"
                        details="Es la contraseña que definiste al generar el CSD en el SAT (no es tu e.firma)."
                      />

                      <s-stack direction="inline" gap="small-200">
                        <s-button
                          type="submit"
                          variant="primary"
                          loading={conectandoCfdi}
                          disabled={
                            conectandoCfdi ||
                            !config.fiscal.razonSocial ||
                            !config.fiscal.cp
                          }
                        >
                          {emisor.certUploaded
                            ? "Actualizar certificado"
                            : "Conectar emisor"}
                        </s-button>
                        {emisor.certUploaded ? (
                          <s-button onClick={() => setMostrarCsd(false)}>
                            Cancelar
                          </s-button>
                        ) : null}
                      </s-stack>
                    </s-stack>
                  </cfdiFetcher.Form>
                )}
              </s-stack>
            </s-section>
          )}
        </>
      ) : null}

      {/* ---------- NOTIFICACIONES ---------- */}
      {tab === "notificaciones" ? (
        <s-section heading="Notificaciones por correo">
          <s-stack gap="base">
            <s-paragraph color="subdued">
              Te avisamos cuando un cliente solicita una cotización desde tu
              tienda, para que respondas rápido.
            </s-paragraph>
            <s-email-field
              label="Correo para avisos"
              placeholder={shopEmail || "ventas@tuempresa.com"}
              details={`Si lo dejas vacío usamos el correo de tu tienda${shopEmail ? ` (${shopEmail})` : ""}.`}
              value={config.notificaciones.email}
              onChange={(e: any) =>
                set("notificaciones", { email: e.currentTarget.value })
              }
            />
            <s-switch
              label="Avisarme de nuevas solicitudes"
              details="Recibe un correo cada vez que llega una cotización desde la tienda."
              checked={config.notificaciones.avisarNuevaSolicitud}
              onChange={() =>
                set("notificaciones", {
                  avisarNuevaSolicitud:
                    !config.notificaciones.avisarNuevaSolicitud,
                })
              }
            />
          </s-stack>
        </s-section>
      ) : null}

      {/* ---------- CORREOS ---------- */}
      {tab === "correos" && !hasPaid
        ? lockCard(
            "Plantillas de correo",
            "Edita el asunto y el texto de los correos automáticos (confirmación al cliente, aviso al vendedor y envío de la cotización) desde el Plan Básico.",
          )
        : null}
      {tab === "correos" && hasPaid ? (
        <s-section heading="Plantillas de correo">
          <s-stack gap="base">
            <s-paragraph color="subdued">
              Personaliza el asunto y el texto de los correos automáticos. Usa
              las variables (ej. {"{{cliente}}"}) para insertar datos reales.
              La vista previa se actualiza al instante.
            </s-paragraph>

            {/* Selector del correo a editar */}
            <s-select
              label="Correo a editar"
              value={mailSel}
              onChange={(e: any) => setMailSel(e.currentTarget.value as EmailKey)}
            >
              {(Object.keys(ETIQUETAS_CORREO) as EmailKey[]).map((k) => (
                <s-option key={k} value={k}>
                  {ETIQUETAS_CORREO[k].titulo} — {ETIQUETAS_CORREO[k].sub}
                </s-option>
              ))}
            </s-select>

            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))"
              gap="base"
            >
              {/* Editor */}
              <s-stack gap="base">
                <s-text-field
                  ref={asuntoRef}
                  label="Asunto"
                  value={config.emails[mailSel].asunto}
                  onFocus={() => (ultimoCampo.current = "asunto")}
                  onChange={(e: any) =>
                    setEmail(mailSel, { asunto: e.currentTarget.value })
                  }
                />
                <s-text-field
                  ref={encabezadoRef}
                  label="Encabezado (título dentro del correo)"
                  value={config.emails[mailSel].encabezado}
                  onFocus={() => (ultimoCampo.current = "encabezado")}
                  onChange={(e: any) =>
                    setEmail(mailSel, { encabezado: e.currentTarget.value })
                  }
                />
                <s-text-area
                  ref={mensajeRef}
                  label="Mensaje"
                  details="Deja una línea en blanco entre párrafos."
                  rows={7}
                  value={config.emails[mailSel].mensaje}
                  onFocus={() => (ultimoCampo.current = "mensaje")}
                  onChange={(e: any) =>
                    setEmail(mailSel, { mensaje: e.currentTarget.value })
                  }
                />

                <s-stack gap="small-300">
                  <s-text color="subdued">Insertar variable</s-text>
                  <s-stack direction="inline" gap="small-300">
                    {VARIABLES_POR_CORREO[mailSel].map((v) => (
                      <s-button
                        key={v.token}
                        variant="tertiary"
                        onClick={() => insertarVar(v.token)}
                      >
                        {v.token}
                      </s-button>
                    ))}
                  </s-stack>
                </s-stack>

                {mailSel === "clienteCotizacion" ? (
                  <s-text color="subdued">
                    Este correo incluye automáticamente un botón “Ver y pagar
                    mi cotización” con el link de pago.
                  </s-text>
                ) : null}
                {mailSel === "adminNueva" ? (
                  <s-text color="subdued">
                    Debajo de tu mensaje se añaden automáticamente los datos
                    del solicitante (correo, teléfono, empresa, RFC, etc.).
                  </s-text>
                ) : null}

                <s-stack direction="inline">
                  <s-button variant="tertiary" onClick={restaurarDefault}>
                    Restaurar texto original
                  </s-button>
                </s-stack>
              </s-stack>

              {/* Preview en vivo */}
              <s-stack gap="small-200">
                <s-text color="subdued">Vista previa</s-text>
                <s-text>
                  Asunto: {preview.subject || "(vacío)"}
                </s-text>
                <iframe
                  title="Vista previa del correo"
                  srcDoc={preview.html}
                  style={{
                    width: "100%",
                    height: 460,
                    border: "1px solid #e3e3e3",
                    borderRadius: 8,
                    background: "#f4f5f7",
                  }}
                />
              </s-stack>
            </s-grid>
          </s-stack>
        </s-section>
      ) : null}

      {/* ---------- CREDITO ---------- */}
      {tab === "credito" && !hasPaid
        ? lockCard(
            "Términos de crédito",
            "Define las condiciones de pago (Net 30 / Net 60) que ofreces a tus clientes B2B desde el Plan Básico.",
          )
        : null}
      {tab === "credito" && hasPaid ? (
        <s-section heading="Términos de crédito">
          <s-stack gap="base">
            <s-paragraph color="subdued">
              Elige las condiciones de pago que ofreces a tus clientes B2B.
              Aparecerán como opciones al crear una cotización.
            </s-paragraph>
            <s-stack gap="small-300">
              <s-text color="subdued">Términos que ofreces</s-text>
              <s-stack direction="inline" gap="base">
                {TERMINOS_DISPONIBLES.map((t) => (
                  <s-checkbox
                    key={t}
                    label={t}
                    checked={config.credito.terminos.includes(t)}
                    onChange={() => toggleTermino(t)}
                  />
                ))}
              </s-stack>
            </s-stack>

            <s-select
              label="Término por defecto"
              details="Se preselecciona en cada nueva cotización."
              value={config.credito.porDefecto}
              disabled={config.credito.terminos.length === 0}
              onChange={(e: any) =>
                set("credito", { porDefecto: e.currentTarget.value })
              }
            >
              {config.credito.terminos.length === 0 ? (
                <s-option value="">— selecciona términos arriba —</s-option>
              ) : (
                config.credito.terminos.map((t) => (
                  <s-option key={t} value={t}>
                    {t}
                  </s-option>
                ))
              )}
            </s-select>
          </s-stack>
        </s-section>
      ) : null}

      {/* ---------- BOTON ---------- */}
      {tab === "boton" ? (
        <s-stack gap="base">
          <s-box paddingBlockEnd="small-200">
            <Tabs
              tabs={[
                { id: "texto", label: "Botón de cotización" },
                { id: "solo-cotizacion", label: "Modo solo cotización" },
              ]}
              value={botonTab}
              onChange={(id) => setBotonTab(id as typeof botonTab)}
            />
          </s-box>

          {botonTab === "texto" ? (
            <s-grid
              gridTemplateColumns="minmax(0, 1fr) minmax(280px, 0.8fr)"
              gap="base"
            >
              {/* Lógica */}
              <s-section heading="Lógica">
                <s-stack gap="base">
                  <s-paragraph color="subdued">
                    Personaliza cómo se ve el botón que tus clientes ven en la
                    página de producto de tu tienda.
                  </s-paragraph>
                  <s-text-field
                    label="Texto del botón"
                    placeholder="Solicitar cotización"
                    details={`${config.boton.texto.length}/40 caracteres.`}
                    value={config.boton.texto}
                    onChange={(e: any) =>
                      set("boton", { texto: e.currentTarget.value.slice(0, 40) })
                    }
                  />
                  <s-divider />
                  <s-switch
                    label="Mostrar precio de lista"
                    details="Muestra el precio normal debajo del botón. Desactívalo si tus precios B2B son sólo bajo cotización."
                    checked={config.boton.mostrarPrecio}
                    onChange={() =>
                      set("boton", { mostrarPrecio: !config.boton.mostrarPrecio })
                    }
                  />
                </s-stack>
              </s-section>

              {/* Vista previa (sticky) del botón del STOREFRONT — con la
                  marca del widget, no del admin: por eso lleva su propio
                  estilo inline. */}
              <div style={{ position: "sticky", top: 16, alignSelf: "start" }}>
                <s-section heading="Vista previa">
                  <s-box padding="large-100" background="subdued" borderRadius="base">
                    <s-stack gap="small-200" alignItems="center">
                      <button
                        type="button"
                        style={{
                          display: "inline-flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 3,
                          background: "linear-gradient(135deg, #1a73e8, #4285f4)",
                          color: "#fff",
                          border: 0,
                          borderRadius: 12,
                          padding: "13px 26px",
                          fontSize: 15,
                          fontWeight: 700,
                          cursor: "default",
                        }}
                      >
                        {config.boton.texto || "Solicitar cotización"}
                        {config.boton.mostrarPrecio ? (
                          <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.85 }}>
                            Precio de lista: $1,250.00 MXN
                          </span>
                        ) : null}
                      </button>
                    </s-stack>
                  </s-box>
                </s-section>
              </div>
            </s-grid>
          ) : (
            <s-section heading="Modo solo cotización">
              <s-stack gap="base">
                <s-paragraph color="subdued">
                  Oculta el precio y el botón "Añadir al carrito" de la página
                  de producto para que el cliente solo pueda solicitar
                  cotización. Disponible en todos los planes.
                </s-paragraph>
                <s-unordered-list>
                  <s-list-item>Ocultar el precio del producto</s-list-item>
                  <s-list-item>
                    Ocultar "Añadir al carrito" y pago rápido
                  </s-list-item>
                </s-unordered-list>
                <s-banner tone="info">
                  <s-paragraph>
                    Esta parte vive en el bloque de tema "Solicitar
                    cotización" (no en este metafield) porque necesita
                    aplicarse al cargar la página, antes de que el JS del
                    admin pueda intervenir — así no hay parpadeo del precio.
                    Actívala desde el editor de temas.
                  </s-paragraph>
                </s-banner>
                <s-stack direction="inline">
                  <s-button href={themeEditorUrl} target="_blank" icon="external">
                    Abrir editor de temas
                  </s-button>
                </s-stack>
              </s-stack>
            </s-section>
          )}
        </s-stack>
      ) : null}

      {/* ---------- PDF ---------- */}
      {tab === "pdf" && !hasPaid
        ? lockCard(
            "PDF personalizado",
            "Agrega tu logo, color de marca, datos de tu empresa y un pie de página a las cotizaciones en PDF desde el Plan Básico. En el Plan Gratis el PDF sale con el diseño por defecto.",
          )
        : null}
      {tab === "pdf" && hasPaid ? (
        <s-section heading="Personaliza tu PDF de cotización">
          <s-stack gap="base">
            <s-paragraph color="subdued">
              Así se verá el PDF que descargas o envías a tus clientes desde el
              detalle de cada cotización. Los cambios se ven al instante en la
              vista previa.
            </s-paragraph>

            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))"
              gap="base"
            >
              {/* Columna de edición */}
              <s-stack gap="base">
                <s-stack gap="small-300">
                  <s-text color="subdued">Logo</s-text>
                  <s-stack direction="inline" gap="base" alignItems="center">
                    {config.pdf.logo ? (
                      <s-thumbnail src={config.pdf.logo} alt="logo" />
                    ) : (
                      <s-text color="subdued">Sin logo</s-text>
                    )}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => onLogo(e.target.files?.[0])}
                    />
                    {config.pdf.logo ? (
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={() => setPdf({ logo: "" })}
                      >
                        Quitar
                      </s-button>
                    ) : null}
                  </s-stack>
                  <s-text color="subdued">
                    PNG o JPG, menos de 250 KB. Si no subes logo, se usan las
                    iniciales de tu tienda.
                  </s-text>
                </s-stack>

                <s-stack direction="inline" gap="small-200" alignItems="end">
                  <s-text-field
                    label="Color de la marca"
                    value={config.pdf.color}
                    onChange={(e: any) =>
                      setPdf({ color: e.currentTarget.value })
                    }
                  />
                  <input
                    type="color"
                    aria-label="Elegir color de la marca"
                    value={config.pdf.color}
                    onChange={(e) => setPdf({ color: e.target.value })}
                    style={{ width: 44, height: 34, border: 0, background: "none", padding: 0 }}
                  />
                </s-stack>

                <s-stack gap="small-300">
                  <s-text color="subdued">
                    Datos de tu empresa (aparecen junto al logo)
                  </s-text>
                  <s-text-field
                    label="Dirección"
                    value={config.pdf.empresa.direccion}
                    onChange={(e: any) =>
                      setPdfEmpresa({ direccion: e.currentTarget.value })
                    }
                  />
                  <s-grid
                    gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))"
                    gap="base"
                  >
                    <s-text-field
                      label="Teléfono"
                      value={config.pdf.empresa.telefono}
                      onChange={(e: any) =>
                        setPdfEmpresa({ telefono: e.currentTarget.value })
                      }
                    />
                    <s-text-field
                      label="Email"
                      value={config.pdf.empresa.email}
                      onChange={(e: any) =>
                        setPdfEmpresa({ email: e.currentTarget.value })
                      }
                    />
                  </s-grid>
                  <s-text-field
                    label="Sitio web"
                    value={config.pdf.empresa.web}
                    onChange={(e: any) =>
                      setPdfEmpresa({ web: e.currentTarget.value })
                    }
                  />
                </s-stack>

                <s-text-field
                  label="Mensaje de agradecimiento"
                  placeholder="¡Gracias por su preferencia!"
                  value={config.pdf.pie.agradecimiento}
                  onChange={(e: any) =>
                    setPdfPie({ agradecimiento: e.currentTarget.value })
                  }
                />
                <s-text-field
                  label="Vigencia (opcional)"
                  placeholder="Esta cotización es válida por 15 días."
                  value={config.pdf.pie.vigencia}
                  onChange={(e: any) =>
                    setPdfPie({ vigencia: e.currentTarget.value })
                  }
                />
                <s-text-area
                  label="Términos y condiciones / nota al pie"
                  placeholder="Los precios pueden estar sujetos a vigencia y disponibilidad."
                  rows={4}
                  value={config.pdf.pie.terminos}
                  onChange={(e: any) =>
                    setPdfPie({ terminos: e.currentTarget.value })
                  }
                />

                <s-stack direction="inline">
                  <s-button
                    variant="tertiary"
                    onClick={() => setPdf(DEFAULT_PDF)}
                  >
                    Restaurar diseño por defecto
                  </s-button>
                </s-stack>
              </s-stack>

              {/* Columna de preview */}
              <s-stack gap="small-200">
                <s-text color="subdued">Vista previa</s-text>
                <iframe
                  title="Vista previa del PDF"
                  srcDoc={pdfPreview}
                  style={{
                    width: "100%",
                    height: 620,
                    border: "1px solid #e3e3e3",
                    borderRadius: 8,
                    background: "#f4f5f7",
                  }}
                />
              </s-stack>
            </s-grid>
          </s-stack>
        </s-section>
      ) : null}
        </s-stack>
      </s-grid>

      {/* Save bar contextual de App Bridge: se muestra/oculta según `dirty`
          (useEffect de arriba). Los botones toman las etiquetas nativas del
          admin (Guardar / Descartar). */}
      <ui-save-bar id="config-save-bar">
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
