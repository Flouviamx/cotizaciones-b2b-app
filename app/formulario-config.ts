// ARCHIVO CLIENTE-SEGURO. Personalización del formulario (modal de cotización)
// que el comprador ve en la tienda. Es una feature de **Plan Pro**: cuando la
// tienda es Pro, estos valores SOBREESCRIBEN los del editor de temas; cuando no,
// el modal usa los valores del editor de temas (sin override).
//
// Compartido entre:
//   - config.tsx (App Proxy)      → lo expone al modal SOLO si la tienda es Pro
//   - app.configuracion.tsx (admin) → pestaña "Formulario" para editarlo
//   - el liquid lo consume vía /config y lo aplica encima del tema
//
// NO importar nada de servidor aquí.

export type FormularioConfig = {
  textos: {
    tituloModal: string;
    mensajeExito: string;
    leadPaso1: string; // intro del paso "Productos"
    leadPaso2: string; // intro del paso "Contacto"
    leadPaso3: string; // intro del paso "Revisar"
  };
  apariencia: {
    textoBoton: string;
    colorAcento: string; // acento de la ventana (encabezado, botones, stepper)
    botonBg: string; // fondo del botón "Solicitar cotización"
    botonTextoColor: string; // color del texto del botón
  };
};

export const DEFAULT_FORMULARIO: FormularioConfig = {
  textos: {
    tituloModal: "Solicitar cotización",
    mensajeExito:
      "El vendedor revisará tu solicitud y te contactará con la cotización y el link de pago.",
    leadPaso1:
      "Estos son los productos de tu carrito. Ajusta las cantidades que quieres cotizar.",
    leadPaso2: "Datos adicionales para tu cotización (opcionales).",
    leadPaso3: "Revisa que todo esté correcto antes de enviar.",
  },
  apariencia: {
    textoBoton: "Solicitar cotización",
    colorAcento: "#1a73e8",
    botonBg: "#1a73e8",
    botonTextoColor: "#ffffff",
  },
};

// Combina lo guardado con los defaults para que nunca falte una llave
// (aunque la config se haya guardado con una versión vieja de la app).
export function mergeFormulario(raw: any): FormularioConfig {
  const c = raw && typeof raw === "object" ? raw : {};
  return {
    textos: { ...DEFAULT_FORMULARIO.textos, ...(c.textos ?? {}) },
    apariencia: { ...DEFAULT_FORMULARIO.apariencia, ...(c.apariencia ?? {}) },
  };
}
