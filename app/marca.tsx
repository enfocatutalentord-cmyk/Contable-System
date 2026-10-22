import Link from "next/link";

// Identidad de Empire Tax’N Legal (manual de identidad visual 1.0). Los logos son los archivos maestros en /public/marca;
// no se redibujan ni se cambian de color. Tamaños mínimos del manual: logo completo 220 px, símbolo 64 px.

export const PRODUCTO = "Empire Tax’N Legal · Sistema contable";

// Nombre tipográfico, como en la «línea gráfica» del manual: EMPIRE en blanco y TAX’N LEGAL en dorado.
export function NombreMarca({ pequeño = false }: { pequeño?: boolean }) {
  return (
    <span className={`nombre-marca${pequeño ? " pequeño" : ""}`}>
      <span className="empire">EMPIRE</span>
      <span className="taxn">TAX’N LEGAL</span>
    </span>
  );
}

// Encabezado del menú lateral: símbolo en su versión para fondo verde y el nombre.
export function MarcaMenu() {
  return (
    <Link href="/empresas" className="marca" aria-label="Empire Tax’N Legal · Panel de la firma">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/marca/simbolo-inverso.svg" alt="" width={64} height={59} />
      <span>
        <NombreMarca />
        <span className="producto">Sistema contable</span>
      </span>
    </Link>
  );
}

// Logo completo para las pantallas de entrada: versión principal en claro e inversa en oscuro.
export function LogoCompleto() {
  return (
    <div className="logo-completo">
      <picture>
        <source srcSet="/marca/logo-inverso.svg" media="(prefers-color-scheme: dark)" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marca/logo.svg" alt="Empire Tax’N Legal" width={230} height={240} />
      </picture>
      <div className="producto">Sistema contable</div>
    </div>
  );
}

// Franja superior para las páginas de la firma que no tienen menú lateral.
export function BarraMarca() {
  return (
    <header className="barra-marca">
      <Link href="/empresas" aria-label="Empire Tax’N Legal · Panel de la firma">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marca/simbolo-inverso.svg" alt="" width={64} height={59} />
        <NombreMarca />
      </Link>
      <span className="producto">Sistema contable</span>
    </header>
  );
}
