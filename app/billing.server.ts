// Modo de cobro de Shopify Billing, en UN solo lugar.
//
// En producción pon SHOPIFY_BILLING_TEST="false" en las variables de entorno
// (Vercel) para que los cobros sean REALES. En dev/preview (sin la variable) los
// cobros son de PRUEBA y se aprueban gratis.
//
// CRÍTICO: este mismo valor debe usarse tanto en `billing.request` (al suscribir)
// como en TODOS los `billing.check` (los candados de features). Si no coinciden,
// un comerciante que paga de verdad se vería como Gratis (Shopify no encontraría
// su suscripción real al revisar solo las de prueba). Por eso vive aquí y se
// importa en vez de copiarse en cada ruta.
export const BILLING_TEST = process.env.SHOPIFY_BILLING_TEST !== "false";
