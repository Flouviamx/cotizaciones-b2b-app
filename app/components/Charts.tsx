// Gráficas con la librería OFICIAL de Shopify (@shopify/polaris-viz) — la
// misma que usa el admin nativo (Analytics, Pedidos), así que el resultado es
// visualmente idéntico al admin, no "inspirado en".
//
// ⚠️ SSR: polaris-viz ejecuta código de navegador (window/document) al
// importarse. Por eso NO se importa estático aquí — se carga con import()
// dinámico DENTRO de un useEffect (solo en cliente). Así el bundle del
// servidor nunca evalúa ese módulo y la función serverless no crashea.
// El <Marco> reserva el alto en SSR y monta la gráfica al cargar la librería.
//
// ARCHIVO CLIENTE-SEGURO: no importar nada de servidor aquí.

import { useEffect, useState, type ReactNode } from "react";

// Carga perezosa (una sola vez) de polaris-viz + su CSS. Solo corre en cliente.
let vizPromise: Promise<any> | null = null;
function cargarViz(): Promise<any> {
  if (!vizPromise) {
    vizPromise = Promise.all([
      import("@shopify/polaris-viz"),
      // Import de CSS como side-effect (Vite lo inyecta en cliente).
      import("@shopify/polaris-viz/build/esm/styles.css"),
    ]).then(([mod]) => mod);
  }
  return vizPromise;
}

function useViz() {
  const [viz, setViz] = useState<any>(null);
  useEffect(() => {
    let vivo = true;
    cargarViz().then((mod) => {
      if (vivo) setViz(mod);
    });
    return () => {
      vivo = false;
    };
  }, []);
  return viz;
}

// Contenedor que reserva el alto en SSR y monta el chart solo cuando la
// librería cargó en el cliente.
function Marco({
  alto,
  render,
}: {
  alto: number;
  render: (viz: any) => ReactNode;
}) {
  const viz = useViz();
  return <div style={{ height: alto }}>{viz ? render(viz) : null}</div>;
}

export function GraficaLinea({
  categorias,
  series,
  formatoY,
  alto = 220,
}: {
  categorias: string[];
  series: { label: string; color: string; valores: number[] }[];
  formatoY: (v: number) => string;
  alto?: number;
}) {
  const data = series.map((s) => ({
    name: s.label,
    color: s.color,
    data: categorias.map((c, i) => ({ key: c, value: s.valores[i] ?? 0 })),
  }));
  return (
    <Marco
      alto={alto}
      render={(viz) => (
        <viz.PolarisVizProvider defaultTheme="Light">
          <viz.LineChart
            data={data}
            showLegend={series.length > 1}
            yAxisOptions={{ labelFormatter: (v: any) => formatoY(Number(v ?? 0)) }}
          />
        </viz.PolarisVizProvider>
      )}
    />
  );
}

// Barras horizontales nativas (para tops y desgloses).
export function GraficaBarras({
  datos,
  formato,
  color = "#2c6ecb",
  nombre = "Total",
}: {
  datos: { label: string; valor: number }[];
  formato: (v: number) => string;
  color?: string;
  nombre?: string;
}) {
  if (datos.length === 0) return null;
  return (
    <Marco
      alto={Math.max(120, datos.length * 48)}
      render={(viz) => (
        <viz.PolarisVizProvider defaultTheme="Light">
          <viz.SimpleBarChart
            data={[
              {
                name: nombre,
                color,
                data: datos.map((d) => ({ key: d.label, value: d.valor })),
              },
            ]}
            showLegend={false}
            xAxisOptions={{ labelFormatter: (v: any) => formato(Number(v ?? 0)) }}
          />
        </viz.PolarisVizProvider>
      )}
    />
  );
}

// Embudo real (el mismo componente del embudo de conversión del admin).
export function GraficaEmbudo({
  pasos,
  alto = 280,
}: {
  pasos: { label: string; valor: number }[];
  alto?: number;
}) {
  return (
    <Marco
      alto={alto}
      render={(viz) => (
        <viz.PolarisVizProvider defaultTheme="Light">
          <viz.FunnelChartNext
            data={[
              {
                name: "Embudo",
                data: pasos.map((p) => ({ key: p.label, value: p.valor })),
              },
            ]}
            tooltipLabels={{ reached: "Llegaron", dropped: "No avanzaron" }}
            showPercentages
          />
        </viz.PolarisVizProvider>
      )}
    />
  );
}

// Tarjeta de gráfica estilo admin: título arriba, número grande, gráfica
// abajo — el mismo patrón de las tarjetas de Analytics del admin de Shopify.
export function TarjetaGrafica({
  titulo,
  valor,
  extra,
  children,
}: {
  titulo: string;
  valor: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{titulo}</s-text>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-heading>{valor}</s-heading>
          {extra}
        </s-stack>
        {children}
      </s-stack>
    </s-box>
  );
}
