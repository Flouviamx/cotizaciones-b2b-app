// Tarjeta de indicador (KPI): etiqueta + valor grande + pie opcional.
//
// Se usa dentro de un <s-grid> para armar la fila de métricas de Cotizaciones,
// Analítica y Empresas. Todo con componentes Polaris (caja con borde nativo),
// sin estilos propios.
//
// ARCHIVO CLIENTE-SEGURO: no importar nada de servidor aquí.

import type { ReactNode } from "react";

export function Kpi({
  label,
  value,
  pie,
  children,
}: {
  label: string;
  value: string;
  /** Texto secundario debajo del valor (contexto de la métrica). */
  pie?: string;
  /** Contenido extra: un badge de variación, una barra de progreso, etc. */
  children?: ReactNode;
}) {
  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-stack gap="small-300">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        {pie ? <s-text color="subdued">{pie}</s-text> : null}
        {children ? (
          <s-stack direction="inline">{children}</s-stack>
        ) : null}
      </s-stack>
    </s-box>
  );
}
