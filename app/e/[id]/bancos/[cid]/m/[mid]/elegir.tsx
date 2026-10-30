"use client";

import { useActionState, useState } from "react";
import type { Estado } from "@/app/acciones-cuenta";
import { alEnviar } from "@/app/enviar";

type Linea = { id: string; fecha: string; texto: string; monto: string };

const ver = (c: bigint) => {
  const neg = c < 0n, a = neg ? -c : c;
  return `${neg ? "-" : ""}${(a / 100n).toLocaleString("en-US")}.${(a % 100n).toString().padStart(2, "0")}`;
};
const cent = (t: string) => {
  const [e, d = "0"] = t.replace("-", "").split(".");
  const c = BigInt(e) * 100n + BigInt(d.padEnd(2, "0").slice(0, 2));
  return t.startsWith("-") ? -c : c;
};
const fecha = (iso: string) => iso.split("-").reverse().join("/");

// Marca uno o varios registros (cobros, pagos, asientos) y muestra cuánto falta para llegar al monto del movimiento.
export function ElegirLineas({ accion, lineas, objetivo }: { accion: (e: Estado, fd: FormData) => Promise<Estado>; lineas: Linea[]; objetivo: string }) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const meta = cent(objetivo);
  const suma = lineas.filter((l) => marcadas.has(l.id)).reduce((s, l) => s + cent(l.monto), 0n);
  const cambiar = (id: string) => setMarcadas((m) => {
    const n = new Set(m);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  return (
    <form onSubmit={alEnviar(enviar)}>
      <div className="tabla-envoltura" style={{ marginBottom: 12 }}>
        <table>
          <thead><tr><th /><th>Fecha</th><th>Registro</th><th className="num">Monto</th></tr></thead>
          <tbody>
            {lineas.map((l) => (
              <tr key={l.id} onClick={() => cambiar(l.id)} style={{ cursor: "pointer" }}>
                <td><input type="checkbox" name="linea" value={l.id} checked={marcadas.has(l.id)} onChange={() => cambiar(l.id)} onClick={(e) => e.stopPropagation()} aria-label={l.texto} /></td>
                <td>{fecha(l.fecha)}</td>
                <td>{l.texto}</td>
                <td className="num">{ver(cent(l.monto))}</td>
              </tr>
            ))}
            {lineas.length === 0 && <tr><td colSpan={4}>No hay registros sin conciliar en esta cuenta que vayan en esa dirección.</td></tr>}
          </tbody>
        </table>
      </div>
      <p>
        Marcado: <strong>{ver(suma)}</strong> de {ver(meta)}
        {marcadas.size > 0 && suma !== meta && <span className="aviso-texto"> · falta {ver(meta - suma)}</span>}
      </p>
      {estado.error && <p className="error" role="alert">{estado.error}</p>}
      <button className="primario" disabled={enviando || suma !== meta || marcadas.size === 0}>{enviando ? "Guardando…" : "Conciliar con lo marcado"}</button>
    </form>
  );
}
