import type { MetadataRoute } from "next";

// La aplicación de Empire se instala desde el navegador, sin tienda (bloque 8a; guía de Next.js para Progressive Web Apps).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Empire Tax’N Legal",
    short_name: "Empire",
    description: "Tu cuenta en Empire Tax’N Legal: solicitudes, documentos, impuestos y reportes.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F6F3EC",
    theme_color: "#003D19",
    lang: "es-DO",
    icons: [
      { src: "/app/icono-192.png", sizes: "192x192", type: "image/png" },
      { src: "/app/icono-512.png", sizes: "512x512", type: "image/png" },
      { src: "/app/icono-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
