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
  const { admin } = await authenticate.admin(request);
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

  return {
    config: mergeConfig(guardado),
    shopName: shop.name ?? "",
    shopEmail: shop.email ?? "",
    hasPro,
    hasPaid,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

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

const CSS = `
.cf-wrap { max-width: 980px; margin: 0 auto; padding: 8px 16px 120px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; color: #1a1a2e; }

/* Hero */
.cf-hero { position: relative; overflow: hidden; border-radius: 20px; padding: 26px 28px;
  background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff;
  box-shadow: 0 14px 34px -12px rgba(26,115,232,.5); margin: 8px 0 22px; }
.cf-hero::after { content: ""; position: absolute; top: -60px; right: -40px; width: 220px; height: 220px;
  background: rgba(255,255,255,.12); border-radius: 50%; }
.cf-hero h1 { font-size: 26px; font-weight: 800; margin: 0 0 6px; letter-spacing: -0.02em; position: relative; }
.cf-hero p { font-size: 15px; margin: 0; opacity: .92; position: relative; max-width: 580px; }

/* Tabs */
.cf-tabs { display: flex; gap: 6px; margin-bottom: 18px; flex-wrap: wrap; }
.cf-tab { border: 1px solid #e2e2ea; background: #fff; border-radius: 12px; padding: 10px 16px;
  font-size: 13.5px; font-weight: 700; color: #6b7280; cursor: pointer; display: inline-flex;
  align-items: center; gap: 8px; transition: all .15s; }
.cf-tab:hover { border-color: #cfe0fc; color: #1a56c4; }
.cf-tab.active { background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff; border-color: transparent;
  box-shadow: 0 6px 16px -8px rgba(26,115,232,.6); }

/* Card */
.cf-card { background: #fff; border: 1px solid #ececf0; border-radius: 18px; padding: 26px 28px;
  box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.cf-card h2 { font-size: 17px; font-weight: 750; margin: 0 0 4px; display: flex; align-items: center; gap: 9px; }
.cf-card .sub { font-size: 13.5px; color: #6b7280; margin: 0 0 22px; line-height: 1.5; }

.cf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 18px; }
.cf-grid .full { grid-column: 1 / -1; }
.cf-field { display: flex; flex-direction: column; }
.cf-label { font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px; }
.cf-hint { font-size: 12px; color: #9099a8; margin-top: 5px; }
.cf-input, .cf-select { width: 100%; padding: 11px 12px; border: 1px solid #d8d8e0; border-radius: 10px;
  font-size: 14px; background: #fff; color: #1a1a2e; outline: none; font-family: inherit; box-sizing: border-box; }
.cf-input:focus, .cf-select:focus { border-color: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,.15); }
.cf-input.bad { border-color: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,.12); }
.cf-input.good { border-color: #16a34a; }
.cf-valmsg { font-size: 12px; font-weight: 600; margin-top: 5px; }
.cf-valmsg.bad { color: #dc2626; }
.cf-valmsg.good { color: #15803d; }

/* Toggle */
.cf-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 16px; border: 1px solid #f1f1f4; border-radius: 13px; margin-top: 4px; }
.cf-toggle-row .tt { font-size: 14px; font-weight: 700; }
.cf-toggle-row .td { font-size: 13px; color: #6b7280; margin-top: 2px; line-height: 1.45; }
.cf-switch { flex: 0 0 46px; width: 46px; height: 27px; border-radius: 999px; background: #d8d8e0;
  position: relative; cursor: pointer; transition: background .18s; border: 0; }
.cf-switch.on { background: linear-gradient(135deg, #1a73e8, #4285f4); }
.cf-switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 21px; height: 21px;
  border-radius: 999px; background: #fff; transition: transform .18s; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
.cf-switch.on::after { transform: translateX(19px); }

/* Chips (términos de crédito) */
.cf-chips { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 4px; }
.cf-chip { border: 1.5px solid #d8d8e0; background: #fff; border-radius: 999px; padding: 8px 15px;
  font-size: 13px; font-weight: 700; color: #6b7280; cursor: pointer; transition: all .15s; display: inline-flex; align-items: center; gap: 7px; }
.cf-chip:hover { border-color: #cfe0fc; }
.cf-chip.sel { background: #eef3ff; border-color: #1a73e8; color: #1a56c4; }
.cf-chip .dot { width: 8px; height: 8px; border-radius: 999px; background: #cdd3de; }
.cf-chip.sel .dot { background: #1a73e8; }

/* Preview del botón */
.cf-preview { margin-top: 22px; border: 1px dashed #cfd6e4; border-radius: 14px; padding: 24px;
  background: #fafbfd; text-align: center; }
.cf-preview .plabel { font-size: 11.5px; font-weight: 700; color: #9099a8; text-transform: uppercase;
  letter-spacing: .05em; margin-bottom: 14px; }
.cf-preview-btn { display: inline-flex; flex-direction: column; align-items: center; gap: 3px;
  background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff; border: 0; border-radius: 12px;
  padding: 13px 26px; font-size: 15px; font-weight: 700; cursor: default; box-shadow: 0 8px 20px -8px rgba(26,115,232,.6); }
.cf-preview-btn .price { font-size: 12px; font-weight: 600; opacity: .85; }

/* Barra de guardado flotante */
.cf-savebar { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%) translateY(120px);
  display: flex; align-items: center; gap: 16px; background: #1a1a2e; color: #fff; padding: 12px 14px 12px 22px;
  border-radius: 16px; box-shadow: 0 18px 40px -14px rgba(0,0,0,.5); z-index: 50; opacity: 0;
  transition: transform .28s cubic-bezier(.2,.9,.3,1), opacity .28s; pointer-events: none; }
.cf-savebar.show { transform: translateX(-50%) translateY(0); opacity: 1; pointer-events: auto; }
.cf-savebar .msg { font-size: 14px; font-weight: 600; }
.cf-savebar .acts { display: flex; gap: 8px; }
.cf-sb-btn { border: 0; border-radius: 10px; padding: 10px 18px; font-size: 13.5px; font-weight: 700; cursor: pointer; }
.cf-sb-btn.save { background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff; }
.cf-sb-btn.save:hover { opacity: .92; }
.cf-sb-btn.save:disabled { opacity: .6; cursor: default; }
.cf-sb-btn.discard { background: transparent; color: #c9cdd6; }
.cf-sb-btn.discard:hover { color: #fff; }

/* ---- Correos editables ---- */
.cf-mailpick { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 22px; }
.cf-mailpick-btn { flex: 1; min-width: 150px; text-align: left; border: 1.5px solid #e2e2ea; background: #fff;
  border-radius: 13px; padding: 13px 15px; cursor: pointer; transition: all .15s; }
.cf-mailpick-btn:hover { border-color: #cfe0fc; }
.cf-mailpick-btn.sel { border-color: #1a73e8; background: #f5f8ff; box-shadow: 0 0 0 3px rgba(26,115,232,.1); }
.cf-mailpick-btn .mt { font-size: 13.5px; font-weight: 750; color: #1a1a2e; display: flex; align-items: center; gap: 7px; }
.cf-mailpick-btn .ms { font-size: 12px; color: #6b7280; margin-top: 4px; line-height: 1.4; }

.cf-mailgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
.cf-textarea { width: 100%; padding: 11px 12px; border: 1px solid #d8d8e0; border-radius: 10px;
  font-size: 14px; background: #fff; color: #1a1a2e; outline: none; font-family: inherit; line-height: 1.55;
  box-sizing: border-box; resize: vertical; min-height: 140px; }
.cf-textarea:focus { border-color: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,.15); }

.cf-vars { display: flex; flex-wrap: wrap; gap: 7px; margin: 8px 0 2px; }
.cf-var { border: 1px solid #d8d8e0; background: #fafbfd; border-radius: 8px; padding: 5px 10px;
  font-size: 12px; font-weight: 600; color: #1a56c4; cursor: pointer; transition: all .12s;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.cf-var:hover { border-color: #1a73e8; background: #eef3ff; }

.cf-preview-pane { position: sticky; top: 12px; }
.cf-preview-pane .plabel { font-size: 11.5px; font-weight: 700; color: #9099a8; text-transform: uppercase;
  letter-spacing: .05em; margin-bottom: 10px; }
.cf-mailsubject { font-size: 13px; color: #44474f; margin-bottom: 10px; padding: 9px 12px; background: #f6f7f9;
  border: 1px solid #ececf0; border-radius: 9px; }
.cf-mailsubject b { color: #16161a; font-weight: 700; }
.cf-iframe { width: 100%; height: 460px; border: 1px solid #ececf0; border-radius: 12px; background: #f4f5f7; }
.cf-restore { margin-top: 14px; border: 1px solid #e2e2ea; background: #fff; border-radius: 10px;
  padding: 9px 14px; font-size: 13px; font-weight: 600; color: #6b7280; cursor: pointer; }
.cf-restore:hover { border-color: #f0c0c0; color: #c0392b; }

/* ---- Pestaña PDF ---- */
.cf-logo-row { display: flex; gap: 16px; align-items: center; }
.cf-logo-box { flex: 0 0 84px; width: 84px; height: 84px; border: 1px solid #e2e2ea; border-radius: 14px;
  background: #fafbfd; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.cf-logo-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
.cf-logo-box span { font-size: 12px; color: #9099a8; }
.cf-logo-acts { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.cf-filebtn { display: inline-block; border: 1.5px solid #1a73e8; color: #1a56c4; background: #fff;
  border-radius: 10px; padding: 9px 16px; font-size: 13.5px; font-weight: 700; cursor: pointer; }
.cf-filebtn:hover { background: #eef3ff; }
.cf-link-rm { background: transparent; border: 0; color: #dc2626; font-weight: 600; font-size: 13px; cursor: pointer; padding: 0; }
.cf-color-row { display: flex; gap: 10px; align-items: center; }
.cf-color { width: 52px; height: 42px; padding: 0; border: 1px solid #d8d8e0; border-radius: 10px; background: #fff; cursor: pointer; }

/* Candado de plan (pestaña visible pero bloqueada) */
.cf-lock { text-align: center; padding: 48px 24px; background: linear-gradient(135deg, #f7faff, #eef5ff);
  border: 1px solid #cfe0fc; border-radius: 16px; }
.cf-lock .ic { font-size: 44px; margin-bottom: 12px; }
.cf-lock h3 { font-size: 20px; font-weight: 800; margin: 0 0 10px; letter-spacing: -0.02em; }
.cf-lock p { font-size: 14px; color: #4b5563; line-height: 1.6; max-width: 460px; margin: 0 auto 20px; }
.cf-lock a.go { display: inline-block; background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff;
  text-decoration: none; border-radius: 12px; padding: 12px 26px; font-size: 15px; font-weight: 700;
  box-shadow: 0 12px 28px -10px rgba(26,115,232,.6); }

@media (max-width: 860px) {
  .cf-mailgrid { grid-template-columns: 1fr; }
  .cf-preview-pane { position: static; }
}
@media (max-width: 720px) {
  .cf-grid { grid-template-columns: 1fr; }
  .cf-hero h1 { font-size: 22px; }
}
`;

type TabId =
  | "fiscal"
  | "notificaciones"
  | "correos"
  | "credito"
  | "boton"
  | "pdf";
const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "fiscal", label: "Datos fiscales", icon: "🧾" },
  { id: "notificaciones", label: "Notificaciones", icon: "🔔" },
  { id: "correos", label: "Correos", icon: "✉️" },
  { id: "credito", label: "Crédito", icon: "💳" },
  { id: "boton", label: "Botón en tienda", icon: "🛒" },
  { id: "pdf", label: "PDF", icon: "📄" },
];

function rfcEstado(rfc: string): "vacio" | "ok" | "mal" {
  const v = rfc.trim().toUpperCase();
  if (!v) return "vacio";
  return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(v) ? "ok" : "mal";
}

export default function Configuracion() {
  const { config: inicial, shopEmail, shopName, hasPaid } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  const [tab, setTab] = useState<TabId>("fiscal");
  const [mailSel, setMailSel] = useState<EmailKey>("clienteRecibido");
  const asuntoRef = useRef<HTMLInputElement>(null);
  const encabezadoRef = useRef<HTMLInputElement>(null);
  const mensajeRef = useRef<HTMLTextAreaElement>(null);
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
    <div className="cf-card">
      <div className="cf-lock">
        <div className="ic">🔒</div>
        <h3>{titulo}</h3>
        <p>{desc}</p>
        <a className="go" href="/app/plans">
          Ver planes
        </a>
      </div>
    </div>
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

      <style>{CSS}</style>

      <div className="cf-wrap">
        <div className="cf-hero">
          <h1>Configuración ⚙️</h1>
          <p>
            Ajusta los datos fiscales para tus CFDI, los avisos por correo, los
            términos de crédito y el botón de cotización de tu tienda. Todo en
            un solo lugar.
          </p>
        </div>

        <div className="cf-tabs">
          {TABS.map((t) => {
            // Correos, Crédito y PDF son de pago (Plan Básico). Se ven siempre,
            // pero con candado en el Plan Gratis.
            const dePago = t.id === "correos" || t.id === "credito" || t.id === "pdf";
            return (
              <button
                key={t.id}
                className={`cf-tab ${tab === t.id ? "active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                <span>{t.icon}</span>
                {t.label}
                {dePago && !hasPaid ? <span> 🔒</span> : null}
              </button>
            );
          })}
        </div>

        {/* ---------- FISCAL ---------- */}
        {tab === "fiscal" ? (
          <div className="cf-card">
            <h2>🧾 Datos fiscales del emisor</h2>
            <p className="sub">
              Se usan para timbrar tus facturas CFDI 4.0 con Facturama al cerrar
              una cotización. Captúralos tal como están dados de alta en el SAT.
            </p>
            <div className="cf-grid">
              <div className="cf-field">
                <label className="cf-label">RFC</label>
                <input
                  className={`cf-input ${rfcSt === "mal" ? "bad" : ""} ${rfcSt === "ok" ? "good" : ""}`}
                  placeholder="XAXX010101000"
                  value={config.fiscal.rfc}
                  maxLength={13}
                  onChange={(e) =>
                    set("fiscal", { rfc: e.target.value.toUpperCase() })
                  }
                />
                {rfcSt === "mal" ? (
                  <span className="cf-valmsg bad">
                    El formato no es válido (12 o 13 caracteres).
                  </span>
                ) : rfcSt === "ok" ? (
                  <span className="cf-valmsg good">✓ RFC válido</span>
                ) : (
                  <span className="cf-hint">Persona moral 12 · física 13.</span>
                )}
              </div>

              <div className="cf-field">
                <label className="cf-label">Régimen fiscal</label>
                <select
                  className="cf-select"
                  value={config.fiscal.regimen}
                  onChange={(e) => set("fiscal", { regimen: e.target.value })}
                >
                  {REGIMENES.map(([clave, desc]) => (
                    <option key={clave} value={clave}>
                      {clave} — {desc}
                    </option>
                  ))}
                </select>
              </div>

              <div className="cf-field full">
                <label className="cf-label">Razón social</label>
                <input
                  className="cf-input"
                  placeholder="Mi Empresa SA de CV"
                  value={config.fiscal.razonSocial}
                  onChange={(e) =>
                    set("fiscal", { razonSocial: e.target.value })
                  }
                />
              </div>

              <div className="cf-field">
                <label className="cf-label">Código postal (lugar de expedición)</label>
                <input
                  className="cf-input"
                  placeholder="06700"
                  value={config.fiscal.cp}
                  maxLength={5}
                  inputMode="numeric"
                  onChange={(e) =>
                    set("fiscal", {
                      cp: e.target.value.replace(/\D/g, "").slice(0, 5),
                    })
                  }
                />
                <span className="cf-hint">CP de tu domicilio fiscal.</span>
              </div>
            </div>
          </div>
        ) : null}

        {/* ---------- NOTIFICACIONES ---------- */}
        {tab === "notificaciones" ? (
          <div className="cf-card">
            <h2>🔔 Notificaciones por correo</h2>
            <p className="sub">
              Te avisamos cuando un cliente solicita una cotización desde tu
              tienda, para que respondas rápido.
            </p>
            <div className="cf-grid">
              <div className="cf-field full">
                <label className="cf-label">Correo para avisos</label>
                <input
                  className="cf-input"
                  type="email"
                  placeholder={shopEmail || "ventas@tuempresa.com"}
                  value={config.notificaciones.email}
                  onChange={(e) =>
                    set("notificaciones", { email: e.target.value })
                  }
                />
                <span className="cf-hint">
                  Si lo dejas vacío usamos el correo de tu tienda
                  {shopEmail ? ` (${shopEmail})` : ""}.
                </span>
              </div>
            </div>
            <div className="cf-toggle-row" style={{ marginTop: 16 }}>
              <div>
                <div className="tt">Avisarme de nuevas solicitudes</div>
                <div className="td">
                  Recibe un correo cada vez que llega una cotización desde la
                  tienda.
                </div>
              </div>
              <button
                className={`cf-switch ${config.notificaciones.avisarNuevaSolicitud ? "on" : ""}`}
                aria-label="Avisarme de nuevas solicitudes"
                onClick={() =>
                  set("notificaciones", {
                    avisarNuevaSolicitud:
                      !config.notificaciones.avisarNuevaSolicitud,
                  })
                }
              />
            </div>
          </div>
        ) : null}

        {/* ---------- CORREOS ---------- */}
        {tab === "correos" && !hasPaid
          ? lockCard(
              "Plantillas de correo · Plan Básico",
              "Edita el asunto y el texto de los correos automáticos (confirmación al cliente, aviso al vendedor y envío de la cotización) desde el Plan Básico.",
            )
          : null}
        {tab === "correos" && hasPaid ? (
          <div className="cf-card">
            <h2>✉️ Plantillas de correo</h2>
            <p className="sub">
              Personaliza el asunto y el texto de los correos automáticos. Usa
              las variables (ej. <code>{"{{cliente}}"}</code>) para insertar datos
              reales. El preview de la derecha se actualiza al instante.
            </p>

            {/* Selector del correo a editar */}
            <div className="cf-mailpick">
              {(Object.keys(ETIQUETAS_CORREO) as EmailKey[]).map((k) => (
                <button
                  key={k}
                  className={`cf-mailpick-btn ${mailSel === k ? "sel" : ""}`}
                  onClick={() => setMailSel(k)}
                >
                  <div className="mt">
                    {k === "adminNueva" ? "🔔" : "📧"} {ETIQUETAS_CORREO[k].titulo}
                  </div>
                  <div className="ms">{ETIQUETAS_CORREO[k].sub}</div>
                </button>
              ))}
            </div>

            <div className="cf-mailgrid">
              {/* Editor */}
              <div>
                <div className="cf-field">
                  <label className="cf-label">Asunto</label>
                  <input
                    ref={asuntoRef}
                    className="cf-input"
                    value={config.emails[mailSel].asunto}
                    onFocus={() => (ultimoCampo.current = "asunto")}
                    onChange={(e) =>
                      setEmail(mailSel, { asunto: e.target.value })
                    }
                  />
                </div>

                <div className="cf-field" style={{ marginTop: 14 }}>
                  <label className="cf-label">Encabezado (título dentro del correo)</label>
                  <input
                    ref={encabezadoRef}
                    className="cf-input"
                    value={config.emails[mailSel].encabezado}
                    onFocus={() => (ultimoCampo.current = "encabezado")}
                    onChange={(e) =>
                      setEmail(mailSel, { encabezado: e.target.value })
                    }
                  />
                </div>

                <div className="cf-field" style={{ marginTop: 14 }}>
                  <label className="cf-label">Mensaje</label>
                  <textarea
                    ref={mensajeRef}
                    className="cf-textarea"
                    value={config.emails[mailSel].mensaje}
                    onFocus={() => (ultimoCampo.current = "mensaje")}
                    onChange={(e) =>
                      setEmail(mailSel, { mensaje: e.target.value })
                    }
                  />
                  <span className="cf-hint">
                    Deja una línea en blanco entre párrafos.
                  </span>
                </div>

                <label className="cf-label" style={{ marginTop: 16 }}>
                  Insertar variable
                </label>
                <div className="cf-vars">
                  {VARIABLES_POR_CORREO[mailSel].map((v) => (
                    <button
                      key={v.token}
                      className="cf-var"
                      title={v.etiqueta}
                      onClick={() => insertarVar(v.token)}
                    >
                      {v.token}
                    </button>
                  ))}
                </div>

                {mailSel === "clienteCotizacion" ? (
                  <span className="cf-hint" style={{ display: "block", marginTop: 10 }}>
                    Este correo incluye automáticamente un botón “Ver y pagar mi
                    cotización” con el link de pago.
                  </span>
                ) : null}
                {mailSel === "adminNueva" ? (
                  <span className="cf-hint" style={{ display: "block", marginTop: 10 }}>
                    Debajo de tu mensaje se añaden automáticamente los datos del
                    solicitante (correo, teléfono, empresa, RFC, etc.).
                  </span>
                ) : null}

                <button className="cf-restore" onClick={restaurarDefault}>
                  ↺ Restaurar texto original
                </button>
              </div>

              {/* Preview en vivo */}
              <div className="cf-preview-pane">
                <div className="plabel">Vista previa</div>
                <div className="cf-mailsubject">
                  <b>Asunto:</b> {preview.subject || "(vacío)"}
                </div>
                <iframe
                  className="cf-iframe"
                  title="Vista previa del correo"
                  srcDoc={preview.html}
                />
              </div>
            </div>
          </div>
        ) : null}

        {/* ---------- CREDITO ---------- */}
        {tab === "credito" && !hasPaid
          ? lockCard(
              "Términos de crédito · Plan Básico",
              "Define las condiciones de pago (Net 30 / Net 60) que ofreces a tus clientes B2B desde el Plan Básico.",
            )
          : null}
        {tab === "credito" && hasPaid ? (
          <div className="cf-card">
            <h2>💳 Términos de crédito</h2>
            <p className="sub">
              Elige las condiciones de pago que ofreces a tus clientes B2B.
              Aparecerán como opciones al crear una cotización.
            </p>
            <label className="cf-label">Términos que ofreces</label>
            <div className="cf-chips">
              {TERMINOS_DISPONIBLES.map((t) => {
                const sel = config.credito.terminos.includes(t);
                return (
                  <button
                    key={t}
                    className={`cf-chip ${sel ? "sel" : ""}`}
                    onClick={() => toggleTermino(t)}
                  >
                    <span className="dot" />
                    {t}
                  </button>
                );
              })}
            </div>

            <div className="cf-field" style={{ marginTop: 22, maxWidth: 320 }}>
              <label className="cf-label">Término por defecto</label>
              <select
                className="cf-select"
                value={config.credito.porDefecto}
                disabled={config.credito.terminos.length === 0}
                onChange={(e) =>
                  set("credito", { porDefecto: e.target.value })
                }
              >
                {config.credito.terminos.length === 0 ? (
                  <option value="">— selecciona términos arriba —</option>
                ) : (
                  config.credito.terminos.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))
                )}
              </select>
              <span className="cf-hint">
                Se preselecciona en cada nueva cotización.
              </span>
            </div>
          </div>
        ) : null}

        {/* ---------- BOTON ---------- */}
        {tab === "boton" ? (
          <div className="cf-card">
            <h2>🛒 Botón "Solicitar cotización"</h2>
            <p className="sub">
              Personaliza cómo se ve el botón que tus clientes ven en la página
              de producto de tu tienda.
            </p>
            <div className="cf-grid">
              <div className="cf-field full">
                <label className="cf-label">Texto del botón</label>
                <input
                  className="cf-input"
                  placeholder="Solicitar cotización"
                  maxLength={40}
                  value={config.boton.texto}
                  onChange={(e) => set("boton", { texto: e.target.value })}
                />
                <span className="cf-hint">
                  {config.boton.texto.length}/40 caracteres.
                </span>
              </div>
            </div>
            <div className="cf-toggle-row" style={{ marginTop: 16 }}>
              <div>
                <div className="tt">Mostrar precio de lista</div>
                <div className="td">
                  Muestra el precio normal debajo del botón. Desactívalo si tus
                  precios B2B son sólo bajo cotización.
                </div>
              </div>
              <button
                className={`cf-switch ${config.boton.mostrarPrecio ? "on" : ""}`}
                aria-label="Mostrar precio de lista"
                onClick={() =>
                  set("boton", { mostrarPrecio: !config.boton.mostrarPrecio })
                }
              />
            </div>

            <div className="cf-preview">
              <div className="plabel">Vista previa</div>
              <button className="cf-preview-btn">
                {config.boton.texto || "Solicitar cotización"}
                {config.boton.mostrarPrecio ? (
                  <span className="price">Precio de lista: $1,250.00 MXN</span>
                ) : null}
              </button>
            </div>
          </div>
        ) : null}

        {/* ---------- PDF ---------- */}
        {tab === "pdf" && !hasPaid
          ? lockCard(
              "PDF personalizado · Plan Básico",
              "Agrega tu logo, color de marca, datos de tu empresa y un pie de página a las cotizaciones en PDF desde el Plan Básico. En el Plan Gratis el PDF sale con el diseño por defecto.",
            )
          : null}
        {tab === "pdf" && hasPaid ? (
          <div className="cf-card">
            <h2>📄 Personaliza tu PDF de cotización</h2>
            <p className="sub">
              Así se verá el PDF que descargas o envías a tus clientes desde el
              detalle de cada cotización. Los cambios se ven al instante en la
              vista previa de la derecha.
            </p>

            <div className="cf-mailgrid">
              {/* Columna de edición */}
              <div>
                {/* Logo — disponible desde Básico */}
                <label className="cf-label">Logo</label>
                {hasPaid ? (
                  <div className="cf-logo-row">
                    <div className="cf-logo-box">
                      {config.pdf.logo ? (
                        <img src={config.pdf.logo} alt="logo" />
                      ) : (
                        <span>Sin logo</span>
                      )}
                    </div>
                    <div className="cf-logo-acts">
                      <label className="cf-filebtn">
                        {config.pdf.logo ? "Cambiar logo" : "Subir logo"}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          style={{ display: "none" }}
                          onChange={(e) => onLogo(e.target.files?.[0])}
                        />
                      </label>
                      {config.pdf.logo ? (
                        <button
                          className="cf-link-rm"
                          onClick={() => setPdf({ logo: "" })}
                        >
                          Quitar
                        </button>
                      ) : null}
                      <span className="cf-hint">
                        PNG o JPG, menos de 250 KB. Si no subes logo, se usan las
                        iniciales de tu tienda.
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="cf-hint" style={{ marginTop: 4 }}>
                    Disponible desde el Plan Básico. En tu plan actual se usan las iniciales de tu tienda.
                  </p>
                )}

                {/* Color */}
                <label className="cf-label" style={{ marginTop: 18 }}>
                  Color de la marca
                </label>
                <div className="cf-color-row">
                  <input
                    type="color"
                    className="cf-color"
                    value={config.pdf.color}
                    onChange={(e) => setPdf({ color: e.target.value })}
                  />
                  <input
                    className="cf-input"
                    value={config.pdf.color}
                    onChange={(e) => setPdf({ color: e.target.value })}
                    style={{ maxWidth: 140 }}
                  />
                </div>

                {/* Datos de la empresa */}
                <label className="cf-label" style={{ marginTop: 18 }}>
                  Datos de tu empresa (aparecen junto al logo)
                </label>
                <div className="cf-grid">
                  <div className="cf-field full">
                    <input
                      className="cf-input"
                      placeholder="Dirección"
                      value={config.pdf.empresa.direccion}
                      onChange={(e) =>
                        setPdfEmpresa({ direccion: e.target.value })
                      }
                    />
                  </div>
                  <div className="cf-field">
                    <input
                      className="cf-input"
                      placeholder="Teléfono"
                      value={config.pdf.empresa.telefono}
                      onChange={(e) =>
                        setPdfEmpresa({ telefono: e.target.value })
                      }
                    />
                  </div>
                  <div className="cf-field">
                    <input
                      className="cf-input"
                      placeholder="Email"
                      value={config.pdf.empresa.email}
                      onChange={(e) => setPdfEmpresa({ email: e.target.value })}
                    />
                  </div>
                  <div className="cf-field full">
                    <input
                      className="cf-input"
                      placeholder="Sitio web"
                      value={config.pdf.empresa.web}
                      onChange={(e) => setPdfEmpresa({ web: e.target.value })}
                    />
                  </div>
                </div>

                {/* Pie / notas */}
                <label className="cf-label" style={{ marginTop: 18 }}>
                  Mensaje de agradecimiento
                </label>
                <input
                  className="cf-input"
                  placeholder="¡Gracias por su preferencia!"
                  value={config.pdf.pie.agradecimiento}
                  onChange={(e) =>
                    setPdfPie({ agradecimiento: e.target.value })
                  }
                />

                <label className="cf-label" style={{ marginTop: 14 }}>
                  Vigencia (opcional)
                </label>
                <input
                  className="cf-input"
                  placeholder="Esta cotización es válida por 15 días."
                  value={config.pdf.pie.vigencia}
                  onChange={(e) => setPdfPie({ vigencia: e.target.value })}
                />

                <label className="cf-label" style={{ marginTop: 14 }}>
                  Términos y condiciones / nota al pie
                </label>
                <textarea
                  className="cf-textarea"
                  style={{ minHeight: 90 }}
                  placeholder="Los precios pueden estar sujetos a vigencia y disponibilidad."
                  value={config.pdf.pie.terminos}
                  onChange={(e) => setPdfPie({ terminos: e.target.value })}
                />

                <button
                  className="cf-restore"
                  onClick={() => setPdf(DEFAULT_PDF)}
                >
                  Restaurar diseño por defecto
                </button>
              </div>

              {/* Columna de preview */}
              <div className="cf-preview-pane">
                <div className="plabel">Vista previa</div>
                <iframe
                  className="cf-iframe"
                  style={{ height: 620 }}
                  title="Vista previa del PDF"
                  srcDoc={pdfPreview}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Barra de guardado flotante: aparece sola cuando hay cambios */}
      <div className={`cf-savebar ${dirty ? "show" : ""}`}>
        <span className="msg">Tienes cambios sin guardar</span>
        <div className="acts">
          <button className="cf-sb-btn discard" onClick={descartar} disabled={guardando}>
            Descartar
          </button>
          <button className="cf-sb-btn save" onClick={guardar} disabled={guardando}>
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
