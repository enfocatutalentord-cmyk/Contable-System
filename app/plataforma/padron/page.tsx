import Link from "next/link";
import { exigirDuena } from "@/lib/acceso";
import { estadoPadron, ultimasCargas } from "@/lib/padron-db";
import { verFecha } from "@/lib/montos";
import { CargaPadron } from "./carga";

export const metadata = { title: "Padrón de la DGII · Empire Tax & Legal" };

const dia = (d: Date | null) => (d ? verFecha(d.toISOString().slice(0, 10)) : "—");
const ESTADOS = { en_curso: "En curso", completa: "Completa", fallida: "Cortada" } as const;

// Padrón de contribuyentes de la DGII (P2c.3): se sube cada mes y el sistema lo usa para completar el nombre al escribir un RNC o una cédula.
export default async function Padron() {
  await exigirDuena();
  const [estado, cargas] = await Promise.all([estadoPadron(), ultimasCargas(10)]);
  return (
    <main className="contenido">
      <p className="sub" style={{ marginBottom: 4 }}><Link href="/plataforma">← Consola de la plataforma</Link></p>
      <h1>Padrón de contribuyentes de la DGII</h1>
      <p className="sub">
        {estado.al
          ? <>Cargado el {dia(estado.al)} ({estado.dias === 0 ? "hoy" : `hace ${estado.dias} día${estado.dias === 1 ? "" : "s"}`}) · {estado.filas.toLocaleString("es-DO")} contribuyentes.</>
          : "Todavía no se ha cargado. Mientras tanto, al escribir un RNC el sistema no puede completar el nombre."}
        {estado.dias !== null && estado.dias > 40 && <span className="error"> Ya pasó más de un mes: conviene cargar el archivo nuevo.</span>}
      </p>
      <div className="tarjeta" style={{ display: "grid", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Cargar el archivo de este mes</h2>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>Baja el archivo del RNC desde la página de la DGII (<a href="https://www.dgii.gov.do/app/WebApps/Consultas/RNC/DGII_RNC.zip" target="_blank" rel="noreferrer">DGII_RNC.zip</a>). No hace falta abrirlo.</li>
          <li>Elígelo abajo. Verás cómo se leen las primeras líneas.</li>
          <li>Si se ve bien, toca «Cargar». Son unos cientos de miles de líneas y tarda unos minutos; no cierres la página.</li>
        </ol>
        <CargaPadron />
      </div>
      {cargas.length > 0 && (
        <>
          <h2>Últimas cargas</h2>
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Cuándo</th><th>Archivo</th><th>Quién</th><th>Estado</th><th className="num">Contribuyentes</th><th>Nota</th></tr></thead>
              <tbody>
                {cargas.map((c) => (
                  <tr key={c.id}>
                    <td>{dia(c.iniciada)}</td><td>{c.archivo}</td><td>{c.usuario_nombre}</td><td>{ESTADOS[c.estado]}</td>
                    <td className="num">{c.filas.toLocaleString("es-DO")}</td><td>{c.nota ?? (c.rechazadas ? `${c.rechazadas.toLocaleString("es-DO")} líneas sin leer` : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
