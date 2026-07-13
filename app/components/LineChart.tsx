// Gráfica de línea con la librería OFICIAL de gráficas de Shopify
// (@shopify/polaris-viz) — la misma que usa el admin nativo (Analytics,
// Pedidos), así que el resultado es visualmente idéntico, no "inspirado en".
//
// ARCHIVO CLIENTE-SEGURO: no importar nada de servidor aquí.

import {
  LineChart as PolarisLineChart,
  PolarisVizProvider,
} from "@shopify/polaris-viz";
import "@shopify/polaris-viz/build/esm/styles.css";

export function LineChart({
  categorias,
  series,
  formatoY,
}: {
  categorias: string[];
  series: { label: string; color: string; valores: number[] }[];
  formatoY: (v: number) => string;
}) {
  const data = series.map((s) => ({
    name: s.label,
    color: s.color,
    data: categorias.map((c, i) => ({ key: c, value: s.valores[i] ?? 0 })),
  }));

  return (
    <PolarisVizProvider defaultTheme="Light">
      <div style={{ height: 260 }}>
        <PolarisLineChart
          data={data}
          showLegend={series.length > 1}
          yAxisOptions={{ labelFormatter: (v) => formatoY(Number(v ?? 0)) }}
        />
      </div>
    </PolarisVizProvider>
  );
}
