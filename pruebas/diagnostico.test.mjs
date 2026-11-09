// Entrega 6b.3: reglas del diagnóstico, edición por la firma, iguala de referencia y servicios iniciales.
import assert from "node:assert/strict";
import { test } from "node:test";
import { hallazgosDe, igualaReferencia, inicial, leerDiagnostico, MENSUALES, S, serviciosIniciales } from "../lib/diagnostico.ts";
import { LISTA_P01 } from "../lib/lista-p01.ts";

const nombres = new Set(Object.values(LISTA_P01).flat().map((f) => f[0]));
test("cada servicio de las reglas existe en EMP-P01", () => {
  for (const s of Object.values(S)) assert.ok(nombres.has(s), s);
});

test("las reglas sugieren hallazgos con servicio y prioridad", () => {
  const h = hallazgosDe({ lleva_contabilidad: "No", al_dia: "Atrasados", rnc_estado: "Suspendido", dgii_al_dia: "Tiene deuda", declara_itbis: "No", declara_ir: "No",
    empleados_fijos: "2", en_tss: "Parcial", en_mt: "No", nomina_formal: "No", guarda_facturas: "A veces", doc_faltantes: "Estados de cuenta" }, "juridica");
  assert.equal(h.length, 11);
  assert.ok(h.every((x) => x.prioridad === "alta" || x.prioridad === "media"));
  assert.equal(h.find((x) => x.area === "Documentación").servicio, null);
  assert.equal(h.find((x) => x.hallazgo.includes("renta")).servicio, S.ir2);
  assert.equal(hallazgosDe({ declara_ir: "No" }, "fisica")[0].servicio, S.ir1);
});

test("sin empleados no hay hallazgos laborales y lo pedido no se repite", () => {
  assert.equal(hallazgosDe({ en_tss: "No", nomina_formal: "No" }, null).length, 0);
  const h = hallazgosDe({ lleva_contabilidad: "No", servicios: "Organización contable, Auditoría" }, null);
  assert.equal(h.filter((x) => x.servicio === S.organizar).length, 1);
  assert.equal(h.find((x) => x.hallazgo.includes("Auditoría")).servicio, null, "auditoría: Patricia elige cuál");
});

test("la firma edita: quitar, agregar y validar", () => {
  const prev = inicial({ nombre: "X" }, null, "mediana");
  const f = new FormData();
  f.set("resumen", "Hola"); f.set("categoria", "mediana"); f.set("iguala", "6,000");
  f.set("h0_hallazgo", "Quitado"); f.set("h0_area", "Laboral"); f.set("h0_prioridad", "alta"); f.set("h0_quitar", "on");
  f.set("h1_hallazgo", "Nuevo"); f.set("h1_area", "Contabilidad"); f.set("h1_prioridad", "baja"); f.set("h1_servicio", S.organizar);
  const d = leerDiagnostico(f, prev, nombres);
  assert.equal(d.hallazgos.length, 1);
  assert.equal(d.incluirLevantamiento, false);
  f.set("h1_servicio", "Inventado");
  assert.throws(() => leerDiagnostico(f, prev, nombres), /no está en la lista/);
  f.set("h1_servicio", ""); f.set("categoria", "rara");
  assert.throws(() => leerDiagnostico(f, prev, nombres), /categoría/);
});

test("iguala de referencia y servicios iniciales", () => {
  const p = new Map([[S.registros, "7000.00"], [S.itbis, "6000.00"], [S.nomina, "8000.00"], [S.tss, "6000.00"]]);
  assert.equal(igualaReferencia({ empleados_fijos: "3" }, p, "mediana"), "27000.00");
  assert.equal(igualaReferencia({ declara_itbis: "No aplica" }, new Map([[S.registros, "2500.00"]]), "pequena"), "4000.00", "mínimo");
  assert.equal(igualaReferencia({ declara_itbis: "No aplica" }, new Map([[S.registros, "2500.00"]]), "emprendedor"), "2500.00", "emprendedor sin mínimo");
  const s = serviciosIniciales({ incluirLevantamiento: true, hallazgos: [{ servicio: S.organizar }, { servicio: S.organizar }, { servicio: MENSUALES[0] }, { servicio: null }] });
  assert.deepEqual(s, [S.levantamiento, S.organizar]);
});
