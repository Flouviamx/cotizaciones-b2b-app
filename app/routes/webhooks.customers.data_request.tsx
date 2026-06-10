import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// GDPR: el comerciante solicita los datos personales que la app guarda de un
// cliente. Esta app NO almacena datos personales de clientes en su propia base
// (los datos viven en Shopify, en los Draft Orders). Solo registramos la
// solicitud y respondemos 200.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  console.log(`Webhook GDPR ${topic} para ${shop}`, payload);
  return new Response();
};
