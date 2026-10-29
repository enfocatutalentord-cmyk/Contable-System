// Botones «Excel» y «PDF» de una lista o reporte, con los mismos filtros que la pantalla.
export function Descargar({ href }: { href: string }) {
  const sep = href.includes("?") ? "&" : "?";
  return (
    <span className="descargar">
      <a className="boton" href={`${href}${sep}formato=xlsx`}>Excel</a>
      <a className="boton" href={`${href}${sep}formato=pdf`}>PDF</a>
    </span>
  );
}
