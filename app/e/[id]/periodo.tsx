import { hoyISO } from "@/lib/montos";
import { fechaValida, primerDiaMes, ultimoDiaMes } from "@/lib/reportes";

export function leerPeriodo(sp: { desde?: string; hasta?: string }) {
  const hoy = hoyISO();
  const desde = fechaValida(sp.desde) ? sp.desde : primerDiaMes(hoy);
  const hasta = fechaValida(sp.hasta) ? sp.hasta : ultimoDiaMes(hoy);
  return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
}

export function CamposPeriodo({ desde, hasta }: { desde: string; hasta: string }) {
  return (
    <>
      <label>Desde<input type="date" name="desde" defaultValue={desde} required /></label>
      <label>Hasta<input type="date" name="hasta" defaultValue={hasta} required /></label>
    </>
  );
}
