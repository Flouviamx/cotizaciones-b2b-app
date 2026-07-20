// Rail vertical de íconos — cambia qué panel se muestra en un builder de
// varias secciones (ej. Formulario: Contenido / Apariencia). Mismo lenguaje
// que el "activity bar" de las apps top del App Store (rail angosto a la
// izquierda del panel de edición, ícono activo resaltado con fondo).
//
// ARCHIVO CLIENTE-SEGURO: no importar nada de servidor aquí.

export function IconRail<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { id: T; icon: string; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <s-box border="base" borderRadius="base" padding="small-200" background="base">
      <s-stack gap="small-200">
        {items.map((it) => {
          const activa = it.id === value;
          return (
            <button
              key={it.id}
              type="button"
              title={it.label}
              aria-label={it.label}
              aria-pressed={activa}
              onClick={() => onChange(it.id)}
              style={{
                appearance: "none",
                border: 0,
                background: activa ? "#1a1a1a" : "transparent",
                borderRadius: 8,
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                // El ícono es oscuro por defecto (tone neutral); invertimos
                // solo cuando está activo sobre el fondo #1a1a1a para que
                // quede blanco, sin depender de un color literal en s-icon.
                filter: activa ? "invert(1) brightness(2)" : "none",
              }}
            >
              <s-icon type={it.icon as any} tone="neutral" />
            </button>
          );
        })}
      </s-stack>
    </s-box>
  );
}
