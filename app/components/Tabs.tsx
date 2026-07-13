// Barra de tabs con subrayado, estilo nativo del admin de Shopify.
//
// Polaris web components no incluye un componente de tabs todavía (solo
// existe en la librería React clásica), así que esto es CSS mínimo propio
// siguiendo el lenguaje visual del admin: fondo blanco, texto gris, subrayado
// negro en la pestaña activa. Nada de píldoras de color ni gradientes.
//
// ARCHIVO CLIENTE-SEGURO: no importar nada de servidor aquí.

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; badge?: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: 4,
        borderBottom: "1px solid #e3e3e3",
        overflowX: "auto",
      }}
    >
      {tabs.map((t) => {
        const activa = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activa}
            onClick={() => onChange(t.id)}
            style={{
              appearance: "none",
              background: "transparent",
              border: 0,
              borderBottom: activa
                ? "2px solid #1a1a1a"
                : "2px solid transparent",
              padding: "10px 4px",
              marginBottom: -1,
              marginRight: 20,
              fontSize: 14,
              fontWeight: activa ? 600 : 500,
              color: activa ? "#1a1a1a" : "#616161",
              cursor: "pointer",
              whiteSpace: "nowrap",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {t.label}
            {t.badge ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#616161",
                }}
              >
                {t.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
