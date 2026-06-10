import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// GDPR: 48h después de desinstalar, Shopify pide borrar los datos de la tienda.
// Borramos las sesiones que la app guarda de esa tienda.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  console.log(`Webhook GDPR ${topic} para ${shop}`, payload);

  if (shop) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
