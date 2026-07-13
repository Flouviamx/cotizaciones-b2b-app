// Integración MULTI-TENANT con Facturapi para timbrar CFDI 4.0.
//
// Cada COMERCIANTE es un emisor distinto: tiene su propia "organización" en
// Facturapi, con su propio CSD (certificado del SAT) y su propio RFC. Las
// facturas se timbran con la llave de ESA organización, no con la nuestra.
//
// Dos niveles de credencial:
//   FACTURAPI_USER_KEY   → llave de NUESTRA cuenta. Crea/administra organizaciones.
//   <llave de cada org>  → se genera al conectar y se guarda en la tabla FacturapiOrg
//                          (la "live" cifrada con app/crypto.server.ts).
//
// Flujo de conexión (conectarEmisor): crear org → datos fiscales (updateLegal) →
// subir CSD (uploadCertificate; Facturapi lee el RFC del propio certificado) →
// obtener llaves test+live → guardar.
//
// ⚠️ NO PROBADO en vivo todavía. Al timbrar puede haber que ajustar:
//   - tax_included: lo dicta shop.taxesIncluded (lo pasa el caller en opts.taxIncluded).
//   - product_key 01010101 (genérica), unit_key H87 (Pieza).

import * as FacturapiNS from "facturapi";
import type FacturapiClient from "facturapi";
import prisma from "./db.server";
import { encryptSecret, decryptSecret } from "./crypto.server";

// El SDK se publica como CJS y la clase vive en `.default` del module.exports.
// El interop CJS→ESM puede anidar `.default` en uno o dos niveles según el
// bundler ("Facturapi is not a constructor" si tomas el nivel equivocado).
// Usamos un IMPORT ESTÁTICO (para que Vercel rastree e incluya el paquete en
// todas las funciones — un require dinámico NO se rastrea y rompía la página de
// detalle) y desenredamos los `.default` hasta encontrar la clase (la función).
function resolverClase(mod: any): any {
  let c = mod;
  for (let i = 0; i < 5 && c && typeof c !== "function"; i++) c = c.default;
  return c;
}
const Facturapi = resolverClase(FacturapiNS) as {
  new (apiKey: string, ...args: any[]): FacturapiClient;
};

function userClient(): FacturapiClient {
  const key = process.env.FACTURAPI_USER_KEY;
  if (!key) {
    throw new Error("Falta FACTURAPI_USER_KEY en .env (llave de cuenta de Facturapi).");
  }
  return new Facturapi(key);
}

function mensajeError(e: any): string {
  // FacturapiError trae .message (y a veces .details con la lista de problemas).
  const det = Array.isArray(e?.details)
    ? " — " + e.details.map((d: any) => d?.message || d).join("; ")
    : "";
  return (e?.message || "Error al comunicarse con Facturapi") + det;
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado del emisor de una tienda
// ─────────────────────────────────────────────────────────────────────────────

export type OrgEstado = {
  conectado: boolean;
  rfc?: string;
  legalName?: string;
  certUploaded: boolean;
  livemode: boolean;
};

export async function estadoEmisor(shop: string): Promise<OrgEstado> {
  const org = await prisma.facturapiOrg.findUnique({ where: { shop } });
  if (!org) return { conectado: false, certUploaded: false, livemode: false };
  return {
    conectado: true,
    rfc: org.rfc ?? undefined,
    legalName: org.legalName ?? undefined,
    certUploaded: org.certUploaded,
    livemode: org.livemode,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Conectar / actualizar el emisor (crear org + datos fiscales + subir CSD)
// ─────────────────────────────────────────────────────────────────────────────

export type ConnectInput = {
  legalName: string;
  taxSystem: string;
  zip: string;
  cer: Uint8Array;
  key: Uint8Array;
  password: string;
};

export type ConnectResult = { ok: boolean; rfc?: string; error?: string };

export async function conectarEmisor(
  shop: string,
  input: ConnectInput,
): Promise<ConnectResult> {
  let user: FacturapiClient;
  try {
    user = userClient();
  } catch (e: any) {
    return { ok: false, error: e.message };
  }

  try {
    const existing = await prisma.facturapiOrg.findUnique({ where: { shop } });
    let orgId = existing?.organizationId;

    if (!orgId) {
      const org: any = await user.organizations.create({ name: input.legalName });
      orgId = org.id;
    }

    // Datos fiscales del emisor (el RFC NO va aquí: lo lee del CSD).
    await user.organizations.updateLegal(orgId!, {
      name: input.legalName,
      legal_name: input.legalName,
      tax_system: input.taxSystem,
      address: { zip: input.zip },
    });

    // Subir el CSD (.cer + .key + contraseña). Facturapi valida el certificado
    // contra el SAT y extrae el RFC del emisor.
    const org2: any = await user.organizations.uploadCertificate(
      orgId!,
      input.cer,
      input.key,
      input.password,
    );
    const rfc: string | null =
      org2?.legal?.tax_id || org2?.tax_id || existing?.rfc || null;

    // Obtener las llaves de la organización. La "live" solo se puede LEER al
    // renovarla (Facturapi no la vuelve a mostrar), por eso renovamos una vez.
    const testKey = String(await user.organizations.getTestApiKey(orgId!));
    const liveKey = String(await user.organizations.renewLiveApiKey(orgId!));

    await prisma.facturapiOrg.upsert({
      where: { shop },
      create: {
        shop,
        organizationId: orgId!,
        testKey,
        liveKeyEnc: encryptSecret(liveKey),
        rfc,
        legalName: input.legalName,
        certUploaded: true,
        livemode: false,
      },
      update: {
        organizationId: orgId!,
        testKey,
        liveKeyEnc: encryptSecret(liveKey),
        rfc,
        legalName: input.legalName,
        certUploaded: true,
      },
    });

    return { ok: true, rfc: rfc ?? undefined };
  } catch (e: any) {
    return { ok: false, error: mensajeError(e) };
  }
}

/** Cambia el modo del emisor: false = pruebas, true = facturas reales (live). */
export async function setLivemode(shop: string, livemode: boolean): Promise<void> {
  await prisma.facturapiOrg.update({ where: { shop }, data: { livemode } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Timbrar un CFDI para una tienda
// ─────────────────────────────────────────────────────────────────────────────

export type CfdiResult = { ok: boolean; uuid?: string; error?: string };

type TimbrarOpts = {
  receiver: {
    rfc: string;
    name: string;
    cfdiUse: string;
    fiscalRegime: string;
    taxZipCode: string;
  };
  items: { description: string; quantity: number; unitPrice: number }[];
  /** true si los precios de la tienda YA incluyen IVA (shop.taxesIncluded):
   *  Facturapi desglosa el impuesto del precio en vez de agregarlo encima. */
  taxIncluded?: boolean;
};

export async function timbrarCFDI(
  shop: string,
  opts: TimbrarOpts,
): Promise<CfdiResult> {
  const org = await prisma.facturapiOrg.findUnique({ where: { shop } });
  if (!org || !org.certUploaded) {
    return {
      ok: false,
      error:
        "No has conectado tu facturación CFDI. Ve a Configuración → Datos fiscales y sube tu certificado (CSD).",
    };
  }

  let key: string;
  try {
    if (org.livemode) {
      if (!org.liveKeyEnc) {
        return { ok: false, error: "Falta la llave de producción del emisor." };
      }
      key = decryptSecret(org.liveKeyEnc);
    } else {
      key = org.testKey ?? "";
      if (!key) {
        return { ok: false, error: "Falta la llave de pruebas del emisor." };
      }
    }
  } catch {
    return {
      ok: false,
      error: "No se pudo descifrar la llave del emisor (revisa FACTURAPI_ENC_KEY).",
    };
  }

  const client = new Facturapi(key);
  const IVA = 0.16;
  const items = opts.items.map((it) => ({
    quantity: it.quantity,
    product: {
      description: it.description,
      product_key: "01010101", // clave producto/servicio SAT (genérica)
      unit_key: "H87", // clave unidad SAT: Pieza
      unit_name: "Pieza",
      price: it.unitPrice,
      // Debe reflejar la configuración fiscal de la tienda: si sus precios ya
      // incluyen IVA, se desglosa; si no, se agrega el 16% encima.
      tax_included: opts.taxIncluded === true,
      taxability: "02", // 02 = sí objeto de impuesto
      taxes: [{ type: "IVA", rate: IVA }],
    },
  }));

  try {
    const invoice: any = await client.invoices.create({
      customer: {
        legal_name: opts.receiver.name,
        tax_id: opts.receiver.rfc,
        tax_system: opts.receiver.fiscalRegime,
        address: { zip: opts.receiver.taxZipCode },
      },
      items,
      use: opts.receiver.cfdiUse,
      payment_form: "03", // Transferencia electrónica (ajustar según el pago real)
      payment_method: "PUE", // Pago en una sola exhibición
      type: "I", // Ingreso
      currency: "MXN",
    } as any);
    return { ok: true, uuid: invoice?.uuid };
  } catch (e: any) {
    return { ok: false, error: mensajeError(e) };
  }
}
