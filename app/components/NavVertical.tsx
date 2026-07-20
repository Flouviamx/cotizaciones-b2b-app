// Lista de navegación vertical estilo hub de Configuración del admin de
// Shopify: cada sección es una fila clickable; la activa se resalta con fondo
// y un check a la derecha. Reemplaza las pestañas horizontales en pantallas de
// configuración con muchas secciones.
//
// Polaris web components no trae un componente de "settings nav", así que es
// CSS mínimo propio siguiendo el lenguaje del admin (grises del sistema, sin
// marca propia).
//
// ARCHIVO CLIENTE-SEGURO: no importar nada de servidor aquí.

export function NavVertical<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { id: T; label: string; icon?: string; badge?: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <s-box
      border="base"
      borderRadius="base"
      padding="small-200"
      background="base"
    >
      <div role="tablist" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {items.map((it) => {
          const activa = it.id === value;
          return (
            <button
              key={it.id}
              type="button"
              role="tab"
              aria-selected={activa}
              onClick={() => onChange(it.id)}
              style={{
                appearance: "none",
                border: 0,
                background: activa ? "#f1f1f1" : "transparent",
                borderRadius: 8,
                padding: "8px 10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
                fontSize: 13,
                fontWeight: activa ? 600 : 450,
                color: "#303030",
                transition: "background 0.12s ease",
              }}
              onMouseEnter={(e) => {
                if (!activa) e.currentTarget.style.background = "#f7f7f7";
              }}
              onMouseLeave={(e) => {
                if (!activa) e.currentTarget.style.background = "transparent";
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {it.label}
                {it.badge ? (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#8a8a8a" }}>
                    {it.badge}
                  </span>
                ) : null}
              </span>
              {activa ? (
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M4 10.5L8 14.5L16 6"
                    stroke="#303030"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
            </button>
          );
        })}
      </div>
    </s-box>
  );
}
