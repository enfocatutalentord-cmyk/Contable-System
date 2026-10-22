import type { NextConfig } from "next";

const config: NextConfig = {
  // Adjuntos de hasta 4 MB (más el resto del formulario).
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  // Generadores de Excel y PDF: se cargan desde node_modules con sus archivos de datos (métricas de fuentes del PDF).
  serverExternalPackages: ["exceljs", "pdfmake", "pdfkit"],
  outputFileTracingIncludes: {
    "/e/[id]/exportar/[reporte]": ["./node_modules/pdfkit/js/data/**/*", "./node_modules/pdfmake/**/*"],
  },
};

export default config;
