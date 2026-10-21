import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contable-System",
  description: "Sistema contable para empresas en República Dominicana",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f7f8fa", color: "#1b2433" }}>
        {children}
      </body>
    </html>
  );
}
