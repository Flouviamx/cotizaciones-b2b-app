import { TODOS_LOS_PLANES, LIMITE_FREE } from "./plans";

// Evalúa el límite de cotizaciones del Plan Gratis a partir del cliente admin.
// Funciona en rutas de admin (authenticate.admin) y en el App Proxy
// (authenticate.public.appProxy) — ambos exponen `admin.graphql`.
//
//   - paid: la tienda tiene un plan DE PAGO activo (Básico o Pro). Sin límite.
//   - activas: cotizaciones NO pagadas (OPEN / INVOICE_SENT) que consumen cupo.
//             Las pagadas (COMPLETED) ya no cuentan, así liberan espacio.
//   - bloqueado: true solo si es Gratis y ya llegó al tope.
export async function evaluarLimite(admin: any): Promise<{
  paid: boolean;
  activas: number;
  limite: number;
  bloqueado: boolean;
}> {
  const resp = await admin.graphql(
    `#graphql
      query limiteCotizaciones {
        currentAppInstallation { activeSubscriptions { name status } }
        draftOrders(first: 250, sortKey: UPDATED_AT) {
          edges { node { status } }
        }
      }`,
  );
  const json: any = await resp.json();

  const subs = json.data?.currentAppInstallation?.activeSubscriptions ?? [];
  const paid = subs.some(
    (s: any) => TODOS_LOS_PLANES.includes(s.name) && s.status === "ACTIVE",
  );

  const activas = (json.data?.draftOrders?.edges ?? []).filter(
    (e: any) => e.node?.status !== "COMPLETED",
  ).length;

  return {
    paid,
    activas,
    limite: LIMITE_FREE,
    bloqueado: !paid && activas >= LIMITE_FREE,
  };
}
