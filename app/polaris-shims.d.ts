// Parche temporal de tipos.
//
// El template del scaffold usa la etiqueta <s-app-nav> (el menú de navegación),
// pero la versión actual de @shopify/polaris-types no la declara — los componentes
// web de Polaris están en beta y el template y los tipos quedaron desincronizados.
//
// Esto SOLO calla el error de TypeScript. No cambia nada del funcionamiento de la
// app (el menú ya funciona en tiempo de ejecución). Si en el futuro actualizas los
// paquetes y el tipo ya viene incluido, puedes borrar este archivo.

type SAppNavProps = {
  children?: unknown;
  slot?: string;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": SAppNavProps;
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": SAppNavProps;
    }
  }
}

export {};
