// Lista maestra de clientes de la firma (bloque 1b, Documento maestro, sección 5): filtros y resumen de arriba. La empresa
// propia de la firma no cuenta: es la contabilidad de la firma, no un cliente.

export type ClienteLista = {
  propia: boolean; activa: boolean; nombre: string; rnc: string | null; responsable_id: string | null;
  categoria: string | null; tipo_cliente: string | null; estado_cliente: string; modalidad: string | null;
  fecha_inicio_contrato: string | null; formalizado: boolean; creada: string;
};
export type FiltrosLista = {
  categoria: string; tipo: string; estado: string; modalidad: string; formalizacion: "" | "si" | "no"; responsable: string; buscar: string;
};

const valor = (sp: Record<string, string | undefined>, k: string) => (sp[k] ?? "").trim().slice(0, 80);

export function leerFiltrosLista(sp: Record<string, string | undefined>): FiltrosLista {
  const f = valor(sp, "formalizacion");
  return {
    categoria: valor(sp, "categoria"), tipo: valor(sp, "tipo"), estado: valor(sp, "estado"), modalidad: valor(sp, "modalidad"),
    formalizacion: f === "si" || f === "no" ? f : "", responsable: valor(sp, "responsable"), buscar: valor(sp, "buscar"),
  };
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// «ninguno» en categoría, tipo, modalidad o responsable busca los que no lo tienen llenado.
const coincide = (filtro: string, v: string | null) => !filtro || (filtro === "ninguno" ? !v : v === filtro);

export function filtrarClientes<T extends ClienteLista>(clientes: T[], f: FiltrosLista): T[] {
  const buscar = sinAcentos(f.buscar);
  return clientes.filter((c) =>
    coincide(f.categoria, c.categoria) && coincide(f.tipo, c.tipo_cliente) && coincide(f.modalidad, c.modalidad)
    && coincide(f.responsable, c.responsable_id) && (!f.estado || c.estado_cliente === f.estado)
    && (!f.formalizacion || c.formalizado === (f.formalizacion === "si"))
    && (!buscar || sinAcentos(c.nombre).includes(buscar) || (c.rnc ?? "").includes(buscar.replace(/\D/g, "") || "\0")));
}

export type ResumenLista = { activos: number; nuevos: number; retiradosOEnCero: number; noFormalizados: number; prospectos: number };

// Nuevos: con inicio de contrato (o, sin fecha, con alta en el sistema) en el mes de `hoy`.
export function resumenLista(clientes: ClienteLista[], hoy: string): ResumenLista {
  const mes = hoy.slice(0, 7);
  const deLaFirma = clientes.filter((c) => !c.propia);
  return {
    activos: deLaFirma.filter((c) => c.activa && c.estado_cliente === "activo").length,
    nuevos: deLaFirma.filter((c) => c.estado_cliente !== "prospecto" && (c.fecha_inicio_contrato ?? c.creada).slice(0, 7) === mes).length,
    retiradosOEnCero: deLaFirma.filter((c) => c.estado_cliente === "retirado" || c.estado_cliente === "en_cero").length,
    noFormalizados: deLaFirma.filter((c) => c.estado_cliente !== "retirado" && c.estado_cliente !== "prospecto" && !c.formalizado).length,
    prospectos: deLaFirma.filter((c) => c.estado_cliente === "prospecto").length,
  };
}
