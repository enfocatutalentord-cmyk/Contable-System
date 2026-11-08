// Entrega 6b.2: lectura del levantamiento y estado de situación financiera inicial.
import assert from "node:assert/strict";
import { test } from "node:test";
import { camposLevantamiento, estadoInicial, ErrorLevantamiento, filasDe, ANEXOS, leerLevantamiento, leerPatrimonio } from "../lib/levantamiento.ts";

const fd = (pares) => { const f = new FormData(); for (const [k, v] of pares) f.append(k, v); return f; };
const base = [["nombre", "Colmado Prueba"], ["acepta_nombre", "Ana"], ["acepta_cedula", "00112345678"], ["acepta", "on"]];

test("lee el cuestionario: multi, filas salteadas y lo inventado se ignora", () => {
  const r = leerLevantamiento(fd([...base, ["servicios", "Auditoría"], ["servicios", "Fiscal"], ["servicios", "Hackear"], ["nom2_nombre", "Luis"], ["nom2_bruto", "30,000"], ["x_raro", "1"]]));
  assert.equal(r.servicios, "Auditoría, Fiscal");
  assert.equal(r.nom0_nombre, "Luis", "las filas quedan seguidas");
  assert.equal(r.x_raro, undefined);
  assert.ok(camposLevantamiento().includes("pas29_saldo"));
});

test("rechaza lo que no sirve", () => {
  assert.throws(() => leerLevantamiento(fd(base.slice(1))), ErrorLevantamiento);
  assert.throws(() => leerLevantamiento(fd([...base, ["lleva_contabilidad", "Quizás"]])), /opciones/);
  assert.throws(() => leerLevantamiento(fd([...base, ["gf0_monto", "mil"]])), /fila 1/);
  assert.throws(() => leerLevantamiento(fd(base.filter(([k]) => k !== "acepta"))), /correcta/);
  assert.throws(() => leerPatrimonio(fd([["pat_capital", "-5"]])), /negativo/);
});

test("el estado inicial cuadra y dice de dónde sale", () => {
  const r = { ac0_tipo: "Efectivo", ac0_valor: "100,000", ac1_tipo: "Cuentas por cobrar", ac1_valor: "50000", anc0_tipo: "Vehículo", anc0_valor: "350000",
    anc1_valor: "10000", pas0_tipo: "Proveedor", pas0_saldo: "60000", pas1_tipo: "Hipoteca o leasing", pas1_saldo: "150000", pat_capital: "100000", pat_utilidades: "200000" };
  const e = estadoInicial(r);
  assert.equal(e.activos, 51000000n);
  assert.equal(e.pasivos, 21000000n);
  assert.equal(e.diferencia, 0n);
  const v = (n) => e.lineas.find((l) => l.concepto === n);
  assert.equal(v("Vehículos").monto, 35000000n);
  assert.equal(v("Otros activos no corrientes").monto, 1000000n, "una fila sin tipo no se pierde");
  assert.equal(v("Vehículos").ref, "Anexo 3");
  assert.deepEqual(e.saldos, { efectivo: "100000.00", cxc: "50000.00", activos_fijos: "350000.00", otros_anc: "10000.00", cxp: "60000.00", prestamos_lp: "150000.00", capital: "100000.00", acumulados: "200000.00" });
  const mal = estadoInicial({ ...r, pat_utilidades: "-50000" });
  assert.equal(mal.diferencia, 25000000n);
  assert.equal(mal.sugeridaUtilidades, 20000000n);
});

test("la nómina no se cuenta dos veces y el margen es porcentaje", () => {
  const e = estadoInicial({ ventas_mes: "200000", costos_directos: "50000", gf0_concepto: "Alquiler", gf0_monto: "30000", gf1_concepto: "Nómina", gf1_monto: "40000",
    nom0_nombre: "Luis", nom0_bruto: "40000", gv0_concepto: "Publicidad", gv0_monto: "5000" });
  assert.equal(e.operativa.at(-1).monto, 8000000n);
  assert.equal(e.margen, "40.0 %");
  assert.match(e.avisos[0], /Nómina/);
  assert.match(e.avisos[1], /variables/);
  assert.equal(filasDe({ gf0_concepto: "A" }, ANEXOS[1]).length, 1);
});
