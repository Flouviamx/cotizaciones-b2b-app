// Nombres de los planes. Constantes compartidas entre cliente y servidor
// (este archivo NO importa código de servidor, por eso es seguro en el navegador).
//
// Cada tier (Básico / Pro) tiene una versión mensual y una anual.
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

// Precios (USD)
export const PRECIO_BASICO_MENSUAL = 29;
export const PRECIO_BASICO_ANUAL = 290; // 10 × 29 (ahorra 2 meses)
export const PRECIO_PRO_MENSUAL = 59;
export const PRECIO_PRO_ANUAL = 590; // 10 × 59 (ahorra 2 meses)

// Grupos útiles
export const PLANES_PRO = [PLAN_PRO_MENSUAL, PLAN_PRO_ANUAL];
export const PLANES_BASICO = [PLAN_BASICO_MENSUAL, PLAN_BASICO_ANUAL];
export const TODOS_LOS_PLANES = [
  PLAN_BASICO_MENSUAL,
  PLAN_BASICO_ANUAL,
  PLAN_PRO_MENSUAL,
  PLAN_PRO_ANUAL,
];
