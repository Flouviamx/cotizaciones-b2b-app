// Contador de timbrados CFDI + cobro del excedente.
//
// Pro y Plus incluyen una cuota mensual de facturas (250 / 1000). Cada timbrado
// incrementa el contador del mes (tabla CfdiUsage). Al pasar la cuota, cada
// factura adicional se cobra como "usage charge" de Shopify ($0.20 Pro / $0.10
// Plus). La cuota se reinicia cada mes calendario (clave "YYYY-MM").
//
// Shopify hace cumplir el TOPE (capped amount) por su lado: si el excedente
// rebasa el tope aprobado, el usage charge falla y aquí lo registramos como
// aviso (no bloquea el timbrado, que ya se hizo).

import prisma from "./db.server";
import { cuotaCFDI, PLANES_PRO } from "./plans";
import { notifyMerchantCfdiQuota } from "./notify.server";

// Forma mínima de lo que usamos del contexto de billing de la librería
// (`authenticate.admin(request).billing`), para no acoplarnos a sus genéricos.
type BillingLike = {
  check: (opts: {
    plans?: string[];
    isTest?: boolean;
  }) => Promise<{
    hasActivePayment: boolean;
    appSubscriptions: { name: string; status?: string }[];
  }>;
  createUsageRecord: (opts: {
    description: string;
    price: { amount: number; currencyCode: string };
    isTest: boolean;
    idempotencyKey?: string;
  }) => Promise<unknown>;
};

type AdminLike = {
  graphql: (
    query: string,
    opts?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<any> }>;
};

// Lee el correo del comerciante (config.notificaciones.email o el de la tienda)
// y el nombre de la tienda, para los avisos de cuota.
async function datosComerciante(
  admin: AdminLike,
): Promise<{ merchantEmail: string; shopName: string }> {
  try {
    const r = await admin.graphql(
      `#graphql
        query {
          shop {
            name
            email
            metafield(namespace: "$app:flouvia", key: "config") { value }
          }
        }`,
    );
    const j: any = await r.json();
    const shop = j.data?.shop ?? {};
    let cfg: any = {};
    try {
      if (shop.metafield?.value) cfg = JSON.parse(shop.metafield.value);
    } catch {
      cfg = {};
    }
    const notif = cfg.notificaciones ?? {};
    const merchantEmail =
      (typeof notif.email === "string" && notif.email.trim()) ||
      shop.email ||
      "";
    return { merchantEmail, shopName: shop.name ?? "" };
  } catch (e) {
    console.error("datosComerciante falló", e);
    return { merchantEmail: "", shopName: "" };
  }
}

export type RegistroTimbrado = {
  /** Plan CFDI activo: "pro" | "plus" | null (si la tienda no tiene CFDI). */
  plan: "pro" | "plus" | null;
  /** Timbrados acumulados este mes (incluido el actual). */
  timbrados: number;
  /** Facturas incluidas en la cuota mensual del plan. */
  limite: number;
  /** Tarifa USD por factura adicional. */
  extra: number;
  /** true si este timbrado se cobró como excedente. */
  cobradoExtra: boolean;
  /** Monto USD cobrado por excedente en este timbrado (0 si no aplica). */
  montoCobrado: number;
  /** true si Shopify rechazó el cargo (probablemente se alcanzó el tope). */
  topeAlcanzado: boolean;
};

/** Mes calendario actual como "YYYY-MM". */
function periodoActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Registra un timbrado CFDI para la tienda y cobra el excedente si corresponde.
 * Se llama DESPUÉS de un timbrado exitoso (la factura ya existe en el PAC).
 * Nunca lanza: si algo falla, devuelve el estado y deja un log.
 */
export async function registrarTimbrado(
  shop: string,
  billing: BillingLike,
  admin: AdminLike,
  isTest: boolean,
): Promise<RegistroTimbrado> {
  // Plan CFDI activo (Pro o Plus). PLANES_PRO incluye a Plus.
  let planName = "";
  try {
    const check = await billing.check({ plans: PLANES_PRO, isTest });
    planName =
      check.appSubscriptions.find(
        (s) => (s.status ? s.status === "ACTIVE" : true) && PLANES_PRO.includes(s.name),
      )?.name ?? "";
  } catch (e) {
    console.error("registrarTimbrado: billing.check falló", e);
  }

  const base: RegistroTimbrado = {
    plan: null,
    timbrados: 0,
    limite: 0,
    extra: 0,
    cobradoExtra: false,
    montoCobrado: 0,
    topeAlcanzado: false,
  };

  if (!planName) {
    // Sin plan con CFDI: no debería llegar aquí, pero por seguridad no contamos.
    return base;
  }

  const { limite, extra, esPlus } = cuotaCFDI(planName);
  const periodo = periodoActual();

  // Incrementa el contador del mes de forma atómica (upsert + increment).
  const fila = await prisma.cfdiUsage.upsert({
    where: { shop_periodo: { shop, periodo } },
    create: { shop, periodo, timbrados: 1, extraCobrado: 0 },
    update: { timbrados: { increment: 1 } },
  });

  const res: RegistroTimbrado = {
    plan: esPlus ? "plus" : "pro",
    timbrados: fila.timbrados,
    limite,
    extra,
    cobradoExtra: false,
    montoCobrado: 0,
    topeAlcanzado: false,
  };

  // Avisos de cuota (80% / 100%), una sola vez por mes cada uno.
  const umbral80 = Math.ceil(limite * 0.8);
  let nivel: 80 | 100 | null = null;
  if (fila.timbrados >= limite && !fila.aviso100) nivel = 100;
  else if (fila.timbrados >= umbral80 && !fila.aviso80) nivel = 80;

  if (nivel) {
    try {
      const { merchantEmail, shopName } = await datosComerciante(admin);
      if (merchantEmail) {
        await notifyMerchantCfdiQuota({
          merchantEmail,
          shopName,
          plan: esPlus ? "plus" : "pro",
          nivel,
          timbrados: fila.timbrados,
          limite,
          extra,
        });
      }
      // Al avisar 100% damos por avisado también el 80% (no repetir).
      await prisma.cfdiUsage.update({
        where: { shop_periodo: { shop, periodo } },
        data: nivel === 100 ? { aviso80: true, aviso100: true } : { aviso80: true },
      });
    } catch (e) {
      console.error("registrarTimbrado: aviso de cuota falló", e);
    }
  }

  // ¿Cuántas facturas por encima de la cuota faltan por cobrar?
  const porCobrar = fila.timbrados - limite - fila.extraCobrado;
  if (porCobrar <= 0) return res;

  const monto = +(porCobrar * extra).toFixed(2);
  try {
    await billing.createUsageRecord({
      description: `${porCobrar} CFDI adicional(es) — ${esPlus ? "Plus" : "Pro"} (${periodo})`,
      price: { amount: monto, currencyCode: "USD" },
      isTest,
      idempotencyKey: `cfdi-${shop}-${periodo}-${fila.timbrados}`,
    });
    await prisma.cfdiUsage.update({
      where: { shop_periodo: { shop, periodo } },
      data: { extraCobrado: { increment: porCobrar } },
    });
    res.cobradoExtra = true;
    res.montoCobrado = monto;
  } catch (e) {
    // Probablemente se alcanzó el tope (capped amount) aprobado por el
    // comerciante. El timbrado ya se hizo; solo avisamos.
    console.error("registrarTimbrado: createUsageRecord falló", e);
    res.topeAlcanzado = true;
  }

  return res;
}
