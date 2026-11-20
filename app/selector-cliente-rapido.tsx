"use client";

import { useState } from "react";
import { CampoRnc } from "./campo-rnc";

// Elegir un cliente o crearlo ahí mismo (Prioridad 2.2): la lista, y «+ Cliente nuevo…» con su nombre, su RNC o cédula si lo tiene y, si
// todavía no existe como empresa, la casilla «en constitución». Los campos van con los nombres que lee `clienteDeFormulario`.
export function SelectorClienteRapido({ clientes, crearClientes, etiqueta = "Cliente", requerido = true }: {
  clientes: { id: string; nombre: string }[]; crearClientes: boolean; etiqueta?: string; requerido?: boolean;
}) {
  const [cliente, setCliente] = useState("");
  const [constitucion, setConstitucion] = useState(false);
  return (
    <>
      <label style={{ flex: "2 1 260px" }}>{etiqueta}
        <select name="empresa" value={cliente} onChange={(e) => setCliente(e.target.value)} required={requerido}>
          <option value="" disabled={requerido}>{requerido ? "Elige el cliente" : "Todos los clientes"}</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          {crearClientes && <option value="nuevo">+ Cliente nuevo…</option>}
        </select>
      </label>
      {cliente === "nuevo" && (
        <>
          <label style={{ flex: "2 1 220px" }}>Nombre del cliente nuevo<input name="cliente_nombre" required maxLength={200} placeholder={constitucion ? "Nombre provisional" : ""} /></label>
          <CampoRnc etiqueta="RNC o cédula (si lo tiene)" name="cliente_rnc" llena={{ nombre: "cliente_nombre" }} disabled={constitucion} estilo={{ flex: "1 1 220px" }} />
          <label style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: "1 1 220px" }}>
            <input type="checkbox" name="cliente_constitucion" style={{ minHeight: 0 }} checked={constitucion} onChange={(e) => setConstitucion(e.target.checked)} />
            En constitución (sin RNC todavía)
          </label>
        </>
      )}
    </>
  );
}
