"use client";

import { useState } from "react";
import type { Estado } from "@/app/acciones-cuenta";
import { Formulario } from "@/app/formulario";

type Opcion = { id: string; codigo: string; nombre: string };

// Anotar un gasto que todavía no se paga: oficina (a su cuenta de gasto) o personal (a la cuenta corriente de la socia).
export function NuevoPendiente({ accion, gastos, socias, categoriasOficina, categoriasPersonal, hoy }: {
  accion: (e: Estado, fd: FormData) => Promise<Estado>;
  gastos: Opcion[]; socias: Opcion[]; categoriasOficina: string[]; categoriasPersonal: string[]; hoy: string;
}) {
  const [tipo, setTipo] = useState<"oficina" | "personal">("oficina");
  const cuentas = tipo === "oficina" ? gastos : socias;
  const categorias = tipo === "oficina" ? categoriasOficina : categoriasPersonal;
  return (
    <Formulario accion={accion} boton="Anotar como pendiente" className="fila">
      <label>Es de
        <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value as "oficina" | "personal")}>
          <option value="oficina">Oficina (negocio)</option><option value="personal">Personal o del hogar</option>
        </select>
      </label>
      <label>Toca pagarlo el<input type="date" name="fecha" defaultValue={hoy} required /></label>
      <label style={{ width: 140 }}>Monto (RD$)<input name="monto" inputMode="decimal" required /></label>
      <label>Categoría
        <input name="categoria" list="categorias-pendiente" required={tipo === "personal"} maxLength={80} />
        <datalist id="categorias-pendiente">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
      </label>
      <label style={{ flex: "1 1 240px" }}>{tipo === "oficina" ? "Cuenta de gasto" : "Cuenta corriente de la socia"}
        <select key={tipo} name="cuenta" required defaultValue="">
          <option value="" disabled>Elige…</option>
          {cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
        </select>
      </label>
      <label style={{ flex: "2 1 240px" }}>Descripción<input name="descripcion" maxLength={300} placeholder="Ej.: Luz de noviembre" /></label>
    </Formulario>
  );
}
