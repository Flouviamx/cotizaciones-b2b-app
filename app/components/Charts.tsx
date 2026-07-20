// Gráficas con la librería OFICIAL de Shopify (@shopify/polaris-viz) — la
// misma que usa el admin nativo (Analytics, Pedidos), así que el resultado es
// visualmente idéntico al admin, no "inspirado en".
//
// Los charts miden el DOM (ResizeObserver) y no pueden renderizar en SSR:
// el <Marco> reserva el alto en el servidor y monta la gráfica solo en el
// cliente (evita "document is not defined" y saltos de layout).
//
// ARCHIVO CLIENTE-SEGURO: no importar nada de servidor aquí.

import { useEffect, useState, type ReactNode } from "react";
import {
  LineChart,
  SimpleBarChart,
  FunnelChartNext,
  PolarisVizProvider,
} from "@shopify/polaris-viz";
import "@shopify/polaris-viz/build/esm/styles.css";

function useMontado() {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  return montado;
}

function Marco({ alto, children }: { alto: number; children: ReactNode }) {
  const montado = useMontado();
  return (
    <div style={{ height: alto }}>
      {montado ? (
        <PolarisVizProvider defaultTheme="Light">{children}</PolarisVizProvider>
      ) : null}
    </div>
  );
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
    <Marco alto={alto}>
      <LineChart
        data={data}
        showLegend={series.length > 1}
        yAxisOptions={{ labelFormatter: (v) => formatoY(Number(v ?? 0)) }}
      />
    </Marco>
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
    <Marco alto={Math.max(120, datos.length * 48)}>
      <SimpleBarChart
        data={[
          {
            name: nombre,
            color,
            data: datos.map((d) => ({ key: d.label, value: d.valor })),
          },
        ]}
        showLegend={false}
        xAxisOptions={{ labelFormatter: (v) => formato(Number(v ?? 0)) }}
      />
    </Marco>
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
    <Marco alto={alto}>
      <FunnelChartNext
        data={[
          {
            name: "Embudo",
            data: pasos.map((p) => ({ key: p.label, value: p.valor })),
          },
        ]}
        tooltipLabels={{ reached: "Llegaron", dropped: "No avanzaron" }}
        showPercentages
      />
    </Marco>
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
