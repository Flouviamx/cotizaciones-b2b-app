import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// GDPR: borrar los datos personales de un cliente. Esta app no guarda datos de
// clientes en su propia base (viven en Shopify), así que no hay nada que borrar.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  console.log(`Webhook GDPR ${topic} para ${shop}`, payload);
  return new Response();
};
