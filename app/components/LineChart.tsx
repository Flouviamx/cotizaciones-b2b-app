// Gráfica de líneas ligera (SVG puro, sin dependencias) para Analítica.
//
// Polaris web components no incluye componentes de gráficas todavía, así que
// esto es visualización de datos con estilos propios — igual que el medidor
// de Progreso.tsx. Sigue el lenguaje visual del admin: líneas de cuadrícula
// grises, ejes discretos, sin marca propia de Flouvia.
//
// ARCHIVO CLIENTE-SEGURO: no importar nada de servidor aquí.

type Serie = {
  label: string;
  color: string;
  valores: number[];
};

const ALTO = 200;
const ANCHO = 640;
const PAD_IZQ = 44;
const PAD_DER = 12;
const PAD_TOP = 16;
const PAD_ABAJO = 28;

export function LineChart({
  categorias,
  series,
  formatoY,
}: {
  categorias: string[];
  series: Serie[];
  formatoY: (v: number) => string;
}) {
  const n = categorias.length;
  const max = Math.max(1, ...series.flatMap((s) => s.valores));
  const anchoUtil = ANCHO - PAD_IZQ - PAD_DER;
  const altoUtil = ALTO - PAD_TOP - PAD_ABAJO;

  const x = (i: number) => PAD_IZQ + (n <= 1 ? 0 : (i / (n - 1)) * anchoUtil);
  const y = (v: number) => PAD_TOP + altoUtil - (v / max) * altoUtil;

  const lineasGuia = 4;
  const ticksY = Array.from({ length: lineasGuia + 1 }, (_, i) => (max / lineasGuia) * i);

  return (
    <s-stack gap="small-200">
      {series.length > 1 ? (
        <s-stack direction="inline" gap="base">
          {series.map((s) => (
            <s-stack direction="inline" gap="small-300" alignItems="center" key={s.label}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: s.color,
                  display: "inline-block",
                }}
              />
              <s-text color="subdued">{s.label}</s-text>
            </s-stack>
          ))}
        </s-stack>
      ) : null}

      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label="Gráfica de tendencia"
      >
        {/* líneas guía horizontales + etiquetas del eje Y */}
        {ticksY.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD_IZQ}
              x2={ANCHO - PAD_DER}
              y1={y(v)}
              y2={y(v)}
              stroke="#e3e3e3"
              strokeWidth={1}
            />
            <text
              x={PAD_IZQ - 8}
              y={y(v) + 3}
              textAnchor="end"
              fontSize={10}
              fill="#8a8a8a"
            >
              {formatoY(v)}
            </text>
          </g>
        ))}

        {/* eje X: solo primer, medio y último para no saturar */}
        {categorias.map((c, i) => {
          const mostrar =
            i === 0 || i === n - 1 || i === Math.floor((n - 1) / 2);
          if (!mostrar) return null;
          return (
            <text
              key={i}
              x={x(i)}
              y={ALTO - 8}
              textAnchor="middle"
              fontSize={10}
              fill="#8a8a8a"
              style={{ textTransform: "capitalize" }}
            >
              {c}
            </text>
          );
        })}

        {/* series: línea + área suave + puntos */}
        {series.map((s) => {
          const puntos = s.valores.map((v, i) => `${x(i)},${y(v)}`).join(" ");
          const area = `${PAD_IZQ},${y(0)} ${puntos} ${x(n - 1)},${y(0)}`;
          return (
            <g key={s.label}>
              <polygon points={area} fill={s.color} opacity={0.08} />
              <polyline
                points={puntos}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {s.valores.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={s.color} />
              ))}
            </g>
          );
        })}
      </svg>
    </s-stack>
  );
}
