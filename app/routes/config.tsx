import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { PLANES_PRO, TODOS_LOS_PLANES } from "../plans";
import { mergeFormulario } from "../formulario-config";

// Endpoint público del App Proxy (GET).
// La tienda lo llama desde el modal: /apps/flouvia-cotizaciones/config
// Devuelve lo MÍNIMO que el modal necesita para adaptarse:
//   - pro: si la tienda tiene Plan Pro (para mostrar campos B2B + facturación)
//   - config.boton: texto y si se muestran precios de lista
//   - config.credito: términos de pago que ofrece el vendedor
// NO se expone ningún dato fiscal del vendedor (RFC, etc.).

const NS = "$app:flouvia";
const KEY = "config";

const DEFAULTS = {
  boton: { texto: "Solicitar cotización", mostrarPrecio: false },
  credito: { terminos: ["Net 30", "Net 60"], porDefecto: "Net 30" },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Verifica que la petición venga del App Proxy de Shopify (HMAC).
  const ctx: any = await authenticate.public.appProxy(request);
  const admin = ctx.admin;

  // Si por alguna razón no hay sesión de admin, devolvemos defaults (no Pro)
  // para que el modal siga funcionando en modo básico.
  if (!admin) {
    return Response.json({
      ok: true,
      pro: false,
      paid: false,
      config: { ...DEFAULTS, formulario: null },
    });
  }

  const resp = await admin.graphql(
    `#graphql
      query storefrontConfig {
        currentAppInstallation {
          activeSubscriptions { name status }
        }
        shop {
          metafield(namespace: "${NS}", key: "${KEY}") { value }
        }
      }`,
  );
  const json: any = await resp.json();

  const subs = json.data?.currentAppInstallation?.activeSubscriptions ?? [];
  const pro = subs.some(
    (s: any) => PLANES_PRO.includes(s.name) && s.status === "ACTIVE",
  );
  // paid = tiene cualquier plan de pago (Básico o Pro). En Gratis (false) el
  // modal muestra el badge "Cotizaciones por Flouvia".
  const paid = subs.some(
    (s: any) => TODOS_LOS_PLANES.includes(s.name) && s.status === "ACTIVE",
  );

  let cfg: any = null;
  try {
    const v = json.data?.shop?.metafield?.value;
    if (v) cfg = JSON.parse(v);
  } catch {
    // valor corrupto: usamos defaults
  }

  const config = {
    boton: { ...DEFAULTS.boton, ...(cfg?.boton ?? {}) },
    credito: { ...DEFAULTS.credito, ...(cfg?.credito ?? {}) },
    // Personalización del formulario: solo se entrega si la tienda es Pro.
    // Si no, el modal usa los valores del editor de temas (null = sin override).
    formulario: pro ? mergeFormulario(cfg?.formulario) : null,
  };

  return Response.json({ ok: true, pro, paid, config });
};
