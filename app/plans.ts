// Nombres de los planes. Constantes compartidas entre cliente y servidor
// (este archivo NO importa código de servidor, por eso es seguro en el navegador).
//
// Cada tier (Básico / Pro / Plus) tiene una versión mensual y una anual.
// El anual cuesta 10 meses (ahorra 2 meses).

// Plan Gratis: NO es una suscripción de Shopify (no cobra nada). "Gratis" = la
// tienda no tiene ningún plan de pago activo. Sirve de gancho: deja usar lo
// esencial pero con un tope de cotizaciones activas para empujar al Básico.
export const PLAN_FREE = "Plan Gratis";
export const LIMITE_FREE = 5; // máximo de cotizaciones activas (no pagadas) en Gratis

export const PLAN_BASICO_MENSUAL = "Plan Básico Mensual";
export const PLAN_BASICO_ANUAL = "Plan Básico Anual";
export const PLAN_PRO_MENSUAL = "Plan Pro Mensual";
export const PLAN_PRO_ANUAL = "Plan Pro Anual";
// Plan Plus: solo para tiendas Shopify Plus (se valida con shop.plan.shopifyPlus).
export const PLAN_PLUS_MENSUAL = "Plan Plus Mensual";
export const PLAN_PLUS_ANUAL = "Plan Plus Anual";

// Precios (USD)
export const PRECIO_BASICO_MENSUAL = 29;
export const PRECIO_BASICO_ANUAL = 290; // 10 × 29 (ahorra 2 meses)
export const PRECIO_PRO_MENSUAL = 59;
export const PRECIO_PRO_ANUAL = 590; // 10 × 59 (ahorra 2 meses)
export const PRECIO_PLUS_MENSUAL = 149;
export const PRECIO_PLUS_ANUAL = 1490; // 10 × 149 (ahorra 2 meses)

// ─────────────────────────────────────────────────────────────────────────────
// CFDI: cuota de facturas incluidas por mes y cobro por excedente.
//
// Pro y Plus incluyen CFDI automático. Cada plan trae una cuota mensual de
// timbrados; al pasarse, cada factura adicional se cobra como "usage charge"
// (cargo por uso) de Shopify. El excedente del Pro es más caro a propósito:
// empuja a subir a Plus cuando el volumen crece.
// ─────────────────────────────────────────────────────────────────────────────
export const CFDI_LIMITE_PRO = 250; // facturas/mes incluidas en Pro
export const CFDI_LIMITE_PLUS = 1000; // facturas/mes incluidas en Plus

export const CFDI_EXTRA_PRO = 0.2; // USD por factura adicional en Pro
export const CFDI_EXTRA_PLUS = 0.1; // USD por factura adicional en Plus

// Tope (capped amount) de excedente que el comerciante aprueba al suscribirse.
// Es el MÁXIMO que Shopify puede cobrar por uso en un periodo de facturación
// sin pedir nueva aprobación. El anual acumula uso durante todo el año → 12×.
export const CFDI_CAP_PRO_MENSUAL = 50; // 250 facturas extra × $0.20
export const CFDI_CAP_PRO_ANUAL = 600; // 12× headroom
export const CFDI_CAP_PLUS_MENSUAL = 100; // 1000 facturas extra × $0.10
export const CFDI_CAP_PLUS_ANUAL = 1200; // 12× headroom

// Grupos útiles
export const PLANES_BASICO = [PLAN_BASICO_MENSUAL, PLAN_BASICO_ANUAL];
// Solo los planes Pro "puros" (sin Plus). Úsalo cuando necesites distinguir
// Pro de Plus (ej. la cuota/tarifa de excedente del CFDI).
export const PLANES_PRO_EXACTO = [PLAN_PRO_MENSUAL, PLAN_PRO_ANUAL];
export const PLANES_PLUS = [PLAN_PLUS_MENSUAL, PLAN_PLUS_ANUAL];

// IMPORTANTE: `PLANES_PRO` es el GRUPO DE GATE de features Pro. Plus es un
// superconjunto de Pro (incluye todo lo Pro + más), así que incluye a Plus.
// Todos los gates existentes (`PLANES_PRO.includes(sub.name)`, `billing.check({
// plans: PLANES_PRO })`) quedan correctos sin cambios: si la tienda tiene Plus,
// también desbloquea las features Pro.
export const PLANES_PRO = [
  PLAN_PRO_MENSUAL,
  PLAN_PRO_ANUAL,
  PLAN_PLUS_MENSUAL,
  PLAN_PLUS_ANUAL,
];

export const TODOS_LOS_PLANES = [
  PLAN_BASICO_MENSUAL,
  PLAN_BASICO_ANUAL,
  PLAN_PRO_MENSUAL,
  PLAN_PRO_ANUAL,
  PLAN_PLUS_MENSUAL,
  PLAN_PLUS_ANUAL,
];

/** Cuota y tarifa de excedente CFDI según el nombre del plan activo. */
export function cuotaCFDI(planName: string): {
  limite: number;
  extra: number;
  esPlus: boolean;
} {
  const esPlus = PLANES_PLUS.includes(planName);
  return esPlus
    ? { limite: CFDI_LIMITE_PLUS, extra: CFDI_EXTRA_PLUS, esPlus: true }
    : { limite: CFDI_LIMITE_PRO, extra: CFDI_EXTRA_PRO, esPlus: false };
}
