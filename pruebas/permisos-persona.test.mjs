// Rediseño R6: permisos por persona con casillas. Plantillas que se suman, alcance por sección y lectura del formulario.
import assert from "node:assert/strict";
import { test } from "node:test";
import { alcanceIncluye, leerPermisosPersona, sumarPlantillas } from "../lib/permisos-persona.ts";
import { PESTANAS_PRIVADAS } from "../lib/pestanas.ts";

const fd = (pares) => { const f = new FormData(); for (const [k, v] of pares) f.append(k, v); return f; };

test("los roles son plantillas que se suman", () => {
  const s = sumarPlantillas([
    { permisos: ["ver", "registrar"], pestanas: ["", "/facturas"] },
    { permisos: ["ver", "adjuntar", "inventado"], pestanas: ["/recepcion", "/no-existe"] },
  ]);
  assert.deepEqual(s.permisos.sort(), ["adjuntar", "registrar", "ver"]);
  assert.deepEqual(s.pestanas, ["", "/recepcion", "/facturas"].filter((x) => s.pestanas.includes(x)));
  assert.ok(!s.pestanas.includes("/no-existe"));
  const todas = sumarPlantillas([{ permisos: ["ver"], pestanas: null }]);
  for (const p of PESTANAS_PRIVADAS) assert.ok(!todas.pestanas.includes(p), "un rol con «todas» no trae lo privado de la socia");
});

test("alcance: todos, solo los suyos o los elegidos", () => {
  const e = { id: "e1", responsable_id: "u1" };
  assert.equal(alcanceIncluye({ alcance: "todos", clientes: [] }, e, "u2"), true);
  assert.equal(alcanceIncluye({ alcance: "mis_clientes", clientes: [] }, e, "u1"), true);
  assert.equal(alcanceIncluye({ alcance: "mis_clientes", clientes: [] }, e, "u2"), false);
  assert.equal(alcanceIncluye({ alcance: "elegidos", clientes: ["e1"] }, e, "u2"), true);
  assert.equal(alcanceIncluye({ alcance: "elegidos", clientes: ["e9"] }, e, "u2"), false);
});

test("el formulario: secciones activas, «ver» se agrega solo y lo inventado se descarta", () => {
  const p = leerPermisosPersona(fd([
    ["clientes_activo", "on"], ["c_permiso", "registrar"], ["c_permiso", "hackear"], ["c_pestana", "/facturas"], ["c_pestana", "/nada"],
    ["alcance", "todos"], ["crear_clientes", "on"], ["plantilla", "Coordinadora"],
  ]));
  assert.deepEqual(p.clientes, { permisos: ["ver", "registrar"], pestanas: ["/facturas"] });
  assert.equal(p.empire, null, "sin marcar Contabilidad Empire no tiene acceso propio");
  assert.equal(p.alcance, "todos");
  assert.equal(p.crearClientes, true);
  assert.deepEqual(p.plantillas, ["Coordinadora"]);
  assert.equal(leerPermisosPersona(fd([["alcance", "raro"]])).alcance, "elegidos");
});
