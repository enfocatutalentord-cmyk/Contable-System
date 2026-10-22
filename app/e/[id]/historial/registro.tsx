import { ACCIONES, describir, historial, nombresHistorial, TABLAS } from "@/lib/auditoria";
import { conEmpresa } from "@/lib/db";

// Historial de un registro (por ejemplo, un asiento y sus líneas).
export async function HistorialRegistro({ empresaId, registroId }: { empresaId: string; registroId: string }) {
  const { cambios, nombres } = await conEmpresa(empresaId, async (tx) => ({ cambios: await historial(tx, { registro: registroId }, 100), nombres: await nombresHistorial(tx) }));
  if (cambios.length === 0) return <p className="sub">Sin cambios registrados.</p>;
  return (
    <div className="tabla-envoltura">
      <table>
        <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Detalle</th></tr></thead>
        <tbody>
          {cambios.map((c) => (
            <tr key={c.id}>
              <td style={{ whiteSpace: "nowrap" }}>{c.fecha.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" })}</td>
              <td>{c.usuario ?? "Sistema"}</td>
              <td>{ACCIONES[c.accion]} {(TABLAS[c.tabla] ?? c.tabla).toLowerCase()}</td>
              <td>{describir(c, nombres).map((x, i) => <div key={i}>{x}</div>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
