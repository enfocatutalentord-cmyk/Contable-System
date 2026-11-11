import type { Metadata, Viewport } from "next";
import { AvisoVistaPrevia } from "./aviso-vista-previa";
import { PRODUCTO } from "./marca";
import "./globals.css";

export const metadata: Metadata = {
  title: PRODUCTO,
  description: "Sistema contable de Empire Tax’N Legal para firmas que administran empresas en República Dominicana",
  // Instalable en el celular (bloque 8a): icono y nombre en la pantalla de inicio del iPhone.
  icons: { apple: "/app/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Empire", statusBarStyle: "default" },
};

// Tamaño fijo tipo aplicación en el celular: ancho del equipo, sin zoom al entrar ni al tocar un campo.
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, themeColor: "#003D19" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Misma tipografía de apoyo que la web de Empire. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet" />
      </head>
      <body><AvisoVistaPrevia />{children}</body>
    </html>
  );
}
