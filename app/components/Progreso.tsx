// Barra de progreso / medidor.
//
// Polaris web components no incluye un componente de progreso ni de gráficas,
// así que esta es la única pieza visual con estilos propios del admin. Usa los
// colores del sistema de diseño de Shopify (no la marca azul de Flouvia) para
// que no desentone con el resto del admin.
//
// ARCHIVO CLIENTE-SEGURO: no importar nada de servidor aquí.

const PISTA = "#e3e3e3"; // gris de fondo del admin
const RELLENO = "#303030"; // gris oscuro (color de progreso nativo del admin)

export function Progreso({
  pct,
  color,
  alto = 8,
}: {
  /** Porcentaje 0–100. Se recorta al rango automáticamente. */
  pct: number;
  /** Color del relleno. Por defecto el gris del admin. */
  color?: string;
  alto?: number;
}) {
  const v = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        height: alto,
        background: PISTA,
        borderRadius: 999,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${v}%`,
          height: "100%",
          borderRadius: 999,
          background: color ?? RELLENO,
          transition: "width .4s ease",
        }}
      />
    </div>
  );
}
