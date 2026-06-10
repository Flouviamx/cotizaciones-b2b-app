import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Solo autenticamos. Ya NO forzamos un plan de pago: sin suscripción la tienda
  // queda en el Plan Gratis (uso esencial con tope de cotizaciones). El límite se
  // aplica al CREAR cotizaciones, no al entrar a la app, para que puedan probarla.
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Inicio</s-link>
        <s-link href="/app/quotes">Cotizaciones</s-link>
        <s-link href="/app/formulario">Formulario</s-link>
        <s-link href="/app/empresas">Empresas</s-link>
        <s-link href="/app/analitica">Analítica</s-link>
        <s-link href="/app/configuracion">Configuración</s-link>
        <s-link href="/app/plans">Planes</s-link>
        <s-link href="/app/contacto">Contacto</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
