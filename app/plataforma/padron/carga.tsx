"use client";

import { useRef, useState } from "react";
import { unzipSync } from "fflate";
import { useRouter } from "next/navigation";
import { cancelarCargaPadron, empezarCargaPadron, subirTandaPadron, terminarCargaPadron, vistaPreviaPadron } from "./acciones";

// Sube el archivo del padrón de la DGII: lo abre en el navegador (también el .zip tal como se baja), muestra cómo se leen las primeras líneas y lo
// manda al servidor por tandas de unas 8,000 líneas, con una barra de avance. Si se corta, lo ya guardado se queda y se puede volver a subir.

const TANDA = 8000;
type Fila = { rnc: string; nombre: string; nombre_comercial: string | null; actividad: string | null; fecha_inicio: string | null; estado: string | null; regimen: string | null };

function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes); // el archivo de la DGII suele venir así, con tildes en Latin-1
  }
}

async function leerArchivo(f: File): Promise<string> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) { // .zip
    const dentro = unzipSync(bytes, { filter: (x) => /\.(txt|csv)$/i.test(x.name) });
    const nombres = Object.keys(dentro);
    if (!nombres.length) throw new Error("El .zip no trae ningún archivo .txt o .csv.");
    return decodificar(dentro[nombres[0]]);
  }
  return decodificar(bytes);
}

export function CargaPadron() {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<string | null>(null);
  const [lineas, setLineas] = useState<string[]>([]);
  const [vista, setVista] = useState<{ filas: Fila[]; rechazadas: number; separador: string } | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ filas: number; rechazadas: number } | null>(null);

  async function elegir(f: File | undefined) {
    setError(null); setListo(null); setVista(null); setLineas([]); setArchivo(null);
    if (!f) return;
    setLeyendo(true);
    try {
      const texto = await leerArchivo(f);
      const ls = texto.split(/\r?\n/).filter((l) => l.trim());
      const r = await vistaPreviaPadron(ls.slice(0, 60).join("\n"));
      if (!r.ok) throw new Error(r.error);
      if (!r.filas.length) throw new Error("No encontré líneas que empiecen con un RNC (9 dígitos) o una cédula (11). Revisa que sea el archivo del RNC de la DGII.");
      setArchivo(f.name); setLineas(ls); setVista(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo.");
    } finally {
      setLeyendo(false);
    }
  }

  async function cargar() {
    if (!archivo) return;
    setError(null);
    const e = await empezarCargaPadron(archivo);
    if (!e.ok) { setError(e.error); return; }
    const total = lineas.length;
    setAvance({ hechas: 0, total });
    try {
      for (let i = 0; i < total; i += TANDA) {
        const r = await subirTandaPadron(e.id, lineas.slice(i, i + TANDA).join("\n"));
        if (!r.ok) throw new Error(r.error);
        setAvance({ hechas: Math.min(i + TANDA, total), total });
      }
      const fin = await terminarCargaPadron(e.id);
      if (!fin.ok) throw new Error(fin.error);
      setListo({ filas: fin.filas, rechazadas: fin.rechazadas });
      setLineas([]); setVista(null); setArchivo(null);
      if (entrada.current) entrada.current.value = "";
      router.refresh();
    } catch (x) {
      const m = x instanceof Error ? x.message : "Se cortó la carga.";
      await cancelarCargaPadron(e.id, m);
      setError(`${m} Lo que ya se guardó se queda; vuelve a subir el archivo para terminar.`);
      router.refresh();
    } finally {
      setAvance(null);
    }
  }

  const cargando = avance !== null;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <label>Archivo del RNC (el .zip tal como se baja de la DGII, o el .txt)
        <input ref={entrada} type="file" accept=".zip,.txt,.csv" disabled={cargando || leyendo} onChange={(e) => elegir(e.target.files?.[0])} />
      </label>
      {leyendo && <p className="sub">Leyendo el archivo… puede tardar unos segundos.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {listo && <p className="exito" role="status">Listo: se leyeron {listo.filas.toLocaleString("es-DO")} contribuyentes{listo.rechazadas ? ` (${listo.rechazadas.toLocaleString("es-DO")} líneas no se pudieron leer)` : ""}. Ya se puede buscar por RNC o cédula.</p>}
      {vista && archivo && !cargando && (
        <>
          <p className="sub">
            «{archivo}»: {lineas.length.toLocaleString("es-DO")} líneas. Así se leen las primeras; si algo está en la columna equivocada, avísame antes de cargar.
          </p>
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>RNC o cédula</th><th>Nombre</th><th>Nombre comercial</th><th>Actividad</th><th>Inicio</th><th>Estado</th><th>Régimen</th></tr></thead>
              <tbody>
                {vista.filas.map((f) => (
                  <tr key={f.rnc}>
                    <td>{f.rnc}</td><td>{f.nombre}</td><td>{f.nombre_comercial ?? "—"}</td><td>{f.actividad ?? "—"}</td>
                    <td>{f.fecha_inicio ?? "—"}</td><td>{f.estado ?? "—"}</td><td>{f.regimen ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div><button type="button" onClick={cargar}>Cargar {lineas.length.toLocaleString("es-DO")} líneas</button></div>
        </>
      )}
      {cargando && avance && (
        <div role="status">
          <progress value={avance.hechas} max={avance.total} style={{ width: "100%" }} />
          <p className="sub">Cargando… {avance.hechas.toLocaleString("es-DO")} de {avance.total.toLocaleString("es-DO")} líneas. No cierres esta página hasta que termine.</p>
        </div>
      )}
    </div>
  );
}
