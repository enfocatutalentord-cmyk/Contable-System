// Días laborables (Prioridad 1.5 del prompt de Patricia, respuesta recomendada 6): de lunes a viernes, sin los feriados de la firma.
// Las fechas van como texto «AAAA-MM-DD».

const dia = (f: string) => new Date(`${f}T00:00:00Z`);
const texto = (d: Date) => d.toISOString().slice(0, 10);

export function esLaborable(fecha: string, feriados: Set<string>): boolean {
  const s = dia(fecha).getUTCDay();
  return s !== 0 && s !== 6 && !feriados.has(fecha);
}

// La fecha que queda al contar n días laborables después de «desde» (el día de inicio no cuenta). Con n = 0, el mismo día.
export function sumarLaborables(desde: string, n: number, feriados: Set<string>): string {
  const d = dia(desde);
  let quedan = n;
  while (quedan > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (esLaborable(texto(d), feriados)) quedan -= 1;
  }
  return texto(d);
}

// Cuántos días laborables hay de «desde» (sin contarlo) a «hasta» (contándolo). Negativo si «hasta» ya pasó.
export function laborablesEntre(desde: string, hasta: string, feriados: Set<string>): number {
  if (hasta === desde) return 0;
  const signo = hasta > desde ? 1 : -1;
  const [a, b] = signo > 0 ? [desde, hasta] : [hasta, desde];
  const d = dia(a);
  let n = 0;
  while (texto(d) < b) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (esLaborable(texto(d), feriados)) n += 1;
  }
  return n * signo;
}
