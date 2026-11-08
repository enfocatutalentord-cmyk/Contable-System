"use client";

import { useState } from "react";

type Rol = { nombre: string; permisos: string[]; pestanas: string[] | null };
type Grupo = { grupo: string; enlaces: [string, string][] };
type Seccion = { permisos: string[]; pestanas: string[] } | null;

// Casillas de los permisos propios de una persona (rediseño R6). Los roles de la firma son plantillas: «Sumar» marca sus casillas
// sin quitar las que ya estaban; después se ajustan a mano para esta persona, sin cambiar el rol para los demás.
export function PermisosPersona({ nombre, permisos, roles, gruposClientes, gruposEmpire, privadas, clientes, inicial }: {
  nombre: string;
  permisos: { clave: string; nombre: string }[];
  roles: Rol[];
  gruposClientes: Grupo[];
  gruposEmpire: Grupo[];
  privadas: string[];
  clientes: { id: string; nombre: string }[];
  inicial: { clientes: Seccion; empire: Seccion; alcance: string; elegidos: string[]; crearClientes: boolean; plantillas: string[] };
}) {
  const [c, setC] = useState({ activo: !!inicial.clientes, permisos: new Set(inicial.clientes?.permisos ?? []), pestanas: new Set(inicial.clientes?.pestanas ?? [""]) });
  const [e, setE] = useState({ activo: !!inicial.empire, permisos: new Set(inicial.empire?.permisos ?? []), pestanas: new Set(inicial.empire?.pestanas ?? [""]) });
  const [alcance, setAlcance] = useState(inicial.alcance);
  const [plantillas, setPlantillas] = useState<string[]>(inicial.plantillas);
  const todas = (g: Grupo[]) => g.flatMap((x) => x.enlaces.map(([r]) => r));

  const sumar = (seccion: "c" | "e", rolNombre: string) => {
    const rol = roles.find((r) => r.nombre === rolNombre);
    if (!rol) return;
    const grupos = seccion === "c" ? gruposClientes : gruposEmpire;
    const pest = rol.pestanas ?? todas(grupos).filter((r) => !privadas.includes(r));
    const set = seccion === "c" ? setC : setE;
    set((s) => ({ activo: true, permisos: new Set([...s.permisos, ...rol.permisos]), pestanas: new Set([...s.pestanas, ...pest.filter((p) => todas(grupos).includes(p))]) }));
    setPlantillas((p) => (p.includes(rolNombre) ? p : [...p, rolNombre]));
  };
  const alternar = (set: typeof setC, campo: "permisos" | "pestanas", v: string) => set((s) => {
    const n = new Set(s[campo]);
    if (n.has(v)) n.delete(v); else n.add(v);
    return { ...s, [campo]: n };
  });

  const bloque = (titulo: string, ayuda: string, prefijo: "c" | "e", s: typeof c, set: typeof setC, grupos: Grupo[]) => (
    <fieldset style={{ border: "1px solid var(--borde)", borderRadius: 10, padding: 12, margin: "0 0 12px" }}>
      <legend style={{ fontWeight: 700, padding: "0 6px" }}>{titulo}</legend>
      <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <input type="checkbox" name={prefijo === "c" ? "clientes_activo" : "empire_activo"} checked={s.activo} style={{ minHeight: 0 }}
          onChange={(ev) => set((x) => ({ ...x, activo: ev.target.checked }))} /> {ayuda}
      </label>
      {s.activo && (
        <>
          <div className="fila" style={{ margin: "8px 0", alignItems: "center" }}>
            <span className="sub">Sumar las casillas de un rol:</span>
            {roles.map((r) => <button key={r.nombre} type="button" className="boton" onClick={() => sumar(prefijo, r.nombre)}>+ {r.nombre}</button>)}
            <button type="button" className="boton" onClick={() => set((x) => ({ ...x, permisos: new Set(), pestanas: new Set([""]) }))}>Desmarcar todo</button>
          </div>
          <p className="sub" style={{ margin: "4px 0" }}>Qué puede hacer · «Registrar» deja borradores; «Contabilizar (aprobar)» los emite o postea.</p>
          <div className="fila" style={{ gap: 4 }}>
            {permisos.map((p) => (
              <label key={p.clave} style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: "1 1 260px" }}>
                <input type="checkbox" name={`${prefijo}_permiso`} value={p.clave} checked={s.permisos.has(p.clave)} style={{ minHeight: 0 }}
                  onChange={() => alternar(set, "permisos", p.clave)} /> {p.nombre}
              </label>
            ))}
          </div>
          <p className="sub" style={{ margin: "10px 0 4px" }}>Qué pantallas ve</p>
          {grupos.map((g) => (
            <div key={g.grupo} style={{ marginBottom: 6 }}>
              <strong style={{ fontSize: "0.85rem" }}>{g.grupo}</strong>
              <div className="fila" style={{ gap: 4 }}>
                {g.enlaces.map(([r, n]) => (
                  <label key={r} style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: "1 1 220px" }}>
                    <input type="checkbox" name={`${prefijo}_pestana`} value={r} checked={s.pestanas.has(r)} style={{ minHeight: 0 }}
                      onChange={() => alternar(set, "pestanas", r)} /> {n}{privadas.includes(r) && " (privada)"}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </fieldset>
  );

  return (
    <div>
      {plantillas.map((p) => <input key={p} type="hidden" name="plantilla" value={p} />)}
      {bloque("Firma · trabajo a los clientes", `${nombre} trabaja con los clientes con estos permisos propios`, "c", c, setC, gruposClientes)}
      {c.activo && (
        <div style={{ margin: "-4px 0 12px" }}>
          <label>Con qué clientes
            <select name="alcance" value={alcance} onChange={(ev) => setAlcance(ev.target.value)}>
              <option value="todos">Todos los clientes</option>
              <option value="mis_clientes">Solo los clientes donde es responsable</option>
              <option value="elegidos">Solo los clientes que se marquen</option>
            </select>
          </label>
          {alcance === "elegidos" && (
            <div className="fila" style={{ gap: 4, marginTop: 6 }}>
              {clientes.map((x) => (
                <label key={x.id} style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: "1 1 220px" }}>
                  <input type="checkbox" name="cliente" value={x.id} defaultChecked={inicial.elegidos.includes(x.id)} style={{ minHeight: 0 }} /> {x.nombre}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      {bloque("Contabilidad Empire", `${nombre} trabaja en la contabilidad de Empire con estos permisos propios`, "e", e, setE, gruposEmpire)}
      <fieldset style={{ border: "1px solid var(--borde)", borderRadius: 10, padding: 12, margin: "0 0 12px" }}>
        <legend style={{ fontWeight: 700, padding: "0 6px" }}>Administración</legend>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input type="checkbox" name="crear_clientes" defaultChecked={inicial.crearClientes} style={{ minHeight: 0 }} /> Crear clientes nuevos (queda como su responsable)
        </label>
        <p className="sub" style={{ margin: "6px 0 0" }}>Editar la ficha de un cliente es la casilla «Editar la ficha de la empresa» de arriba. Personas, roles y accesos los cambia una administradora.</p>
      </fieldset>
    </div>
  );
}
