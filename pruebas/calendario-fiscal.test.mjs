// Prioridad 3 · P3a: calendario fiscal y renovaciones. Las fechas salen de las mismas reglas que la función `vencimiento_fiscal` de la base (se
// comparan una por una), el estado de cada declaración y renovación, lo atrasado, y el calendario completo de un cliente real contra la base.
// Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { eventosDeEmpresa, fechaLimite } from "../lib/calendario-fiscal.ts";

const CAL = [
  { formato: "606", dia: 15 }, { formato: "607", dia: 15 }, { formato: "608", dia: 15 }, { formato: "IT-1", dia: 20 }, { formato: "IR-17", dia: 10 },
  { formato: "IR-2", dia: 120 }, { formato: "Anticipo", dia: 15 }, { formato: "TSS", dia: null },
];
const base = {
  id: "e1", nombre: "Salón Rosa SRL", creada: "2026-01-01", mesCierre: 12, tieneTss: false, obligaciones: [], presentados: [],
  registro: null, comercial: null, asamblea: null, vencimientos: [], ncf: [], certificados: [], tss: [],
};

test("las fechas límite siguen el calendario, el último día del mes, las prórrogas y el IR-2", () => {
  assert.equal(fechaLimite("606", "202610", CAL, []), "2026-11-15");
  assert.equal(fechaLimite("IT-1", "202610", CAL, []), "2026-11-20");
  assert.equal(fechaLimite("IR-17", "202612", CAL, []), "2027-01-10", "el período de diciembre vence en enero");
  assert.equal(fechaLimite("606", "202601", [{ formato: "606", dia: 31 }], []), "2026-02-28", "un día que no existe vence el último del mes");
  assert.equal(fechaLimite("606", "202712", [{ formato: "606", dia: 31 }], []), "2028-01-31");
  assert.equal(fechaLimite("IR-2", "202612", CAL, []), "2027-04-30", "120 días después de cerrar el ejercicio");
  assert.equal(fechaLimite("IR-2", "202606", CAL, []), "2026-10-28");
  assert.equal(fechaLimite("IT-1", "202610", CAL, [{ formato: "IT-1", periodo: "202610", vence: "2026-11-23" }]), "2026-11-23", "la prórroga manda");
  assert.equal(fechaLimite("IT-1", "202611", CAL, [{ formato: "IT-1", periodo: "202610", vence: "2026-11-23" }]), "2026-12-20", "y solo en su mes");
  assert.equal(fechaLimite("TSS", "202610", CAL, []), null, "la TSS sin día no tiene fecha");
  assert.equal(fechaLimite("TSS", "202610", [{ formato: "TSS", dia: 5 }], []), "2026-11-05");
  assert.equal(fechaLimite("Anticipo", "202610", [], []), "2026-11-15", "sin fila usa el día de la lista de obligaciones");
});

test("cada declaración queda presentada, por vencer, pendiente o vencida según lo registrado y la fecha de hoy", () => {
  const d = { ...base, obligaciones: ["f606", "f607", "it1", "ir17"], presentados: [{ formato: "607", periodo: "202610" }] };
  const ev = eventosDeEmpresa({ ...d, creada: "2026-10-01" }, CAL, [], "2026-11", "2026-11-12");
  const por = (t) => ev.find((e) => e.titulo.startsWith(t));
  assert.equal(por("606 de octubre").estado, "por_vencer", "faltan 3 días");
  assert.equal(por("606 de octubre").fecha, "2026-11-15");
  assert.equal(por("607 de octubre").estado, "hecho");
  assert.equal(por("IT-1 de octubre").estado, "pendiente", "faltan 8 días");
  assert.equal(por("IR-17 de octubre").estado, "vencido", "venció el 10 y hoy es 12");
  assert.equal(por("IR-17 de octubre").tipo, "declaracion");
});

test("lo vencido de los 90 días anteriores sale como atrasado y lo presentado no", () => {
  const d = { ...base, creada: "2026-10-01", obligaciones: ["f606", "it1"], presentados: [{ formato: "606", periodo: "202609" }] };
  const ev = eventosDeEmpresa(d, CAL, [], "2026-11", "2026-11-10");
  const atrasados = ev.filter((e) => e.fecha < "2026-11-01");
  assert.deepEqual(atrasados.map((e) => [e.titulo, e.estado, e.fecha]), [["IT-1 de septiembre 2026", "vencido", "2026-10-20"]], "el 606 de septiembre ya se presentó");
  assert.equal(ev.filter((e) => e.fecha >= "2026-11-01").length, 2);
  // Solo se miran los 90 días anteriores al mes: en abril, lo vencido de diciembre a marzo; noviembre (venció el 20-dic) ya no.
  const viejo = eventosDeEmpresa({ ...base, obligaciones: ["it1"] }, CAL, [], "2027-04", "2027-04-10");
  assert.deepEqual(viejo.filter((e) => e.fecha < "2027-04-01").map((e) => e.fecha), ["2027-01-20", "2027-02-20", "2027-03-20"]);
  assert.ok(viejo.every((e) => e.fecha !== "2026-12-20"));
});

test("un cliente nuevo no arrastra lo que venció antes de que entrara", () => {
  const d = { ...base, creada: "2026-11-01", obligaciones: ["f606", "it1"] };
  const ev = eventosDeEmpresa(d, CAL, [], "2026-11", "2026-11-10");
  assert.deepEqual(ev.map((e) => e.titulo), ["606 de octubre 2026", "IT-1 de octubre 2026"]);
});

test("el IR-2 sale en el mes en que vence el ejercicio anterior", () => {
  const d = { ...base, obligaciones: ["ir2"] };
  const abril = eventosDeEmpresa(d, CAL, [], "2026-04", "2026-04-01");
  assert.deepEqual(abril.map((e) => [e.titulo, e.fecha, e.estado]), [["IR-2 del ejercicio 2025", "2026-04-30", "pendiente"]]);
  const hecho = eventosDeEmpresa({ ...d, presentados: [{ formato: "IR-2", periodo: "202512" }] }, CAL, [], "2026-04", "2026-04-01");
  assert.equal(hecho[0].estado, "hecho");
  assert.equal(eventosDeEmpresa(d, CAL, [], "2026-11", "2026-11-10").length, 0);
});

test("el anticipo es un recordatorio y la TSS depende de su notificación y de que tenga día", () => {
  const d = { ...base, obligaciones: ["anticipo"], tieneTss: true };
  const sinDia = eventosDeEmpresa(d, CAL, [], "2026-11", "2026-11-10");
  assert.deepEqual(sinDia.map((e) => [e.titulo, e.estado, e.tipo]), [["Anticipo del ISR de octubre 2026", "recordatorio", "pago"]], "la TSS sin día no sale");
  const cal = CAL.map((c) => (c.formato === "TSS" ? { ...c, dia: 5 } : c));
  const sinNotificacion = eventosDeEmpresa(d, cal, [], "2026-11", "2026-11-10").find((e) => e.titulo.startsWith("Pago a la TSS"));
  assert.equal(sinNotificacion.estado, "recordatorio");
  const pagada = eventosDeEmpresa({ ...d, tss: [{ periodo: "202610", pagada: true }] }, cal, [], "2026-11", "2026-11-10").find((e) => e.titulo.startsWith("Pago a la TSS"));
  assert.equal(pagada.estado, "hecho");
  const sinPagar = eventosDeEmpresa({ ...d, tss: [{ periodo: "202610", pagada: false }] }, cal, [], "2026-11", "2026-11-10").find((e) => e.titulo.startsWith("Pago a la TSS"));
  assert.equal(sinPagar.estado, "vencido", "venció el 5 y no está pagada");
});

test("las renovaciones salen con su aviso y las vencidas siguen hasta renovarse", () => {
  const d = {
    ...base, registro: "2026-11-20", comercial: "2027-01-31", asamblea: "2026-12-15",
    vencimientos: [{ nombre: "Contrato de alquiler", vence: "2026-09-01", avisar_dias: 60 }, { nombre: "Estatutos sociales", vence: "2026-11-28", avisar_dias: 30 }],
    ncf: [{ tipo: "B01", vence: "2026-11-30", quedan: 5 }, { tipo: "B02", vence: "2026-12-31", quedan: 100 }],
    certificados: [{ titular: "Patricia Paulino", vence: "2026-11-25" }],
  };
  const ev = eventosDeEmpresa(d, CAL, [], "2026-11", "2026-11-10");
  const por = (t) => ev.find((e) => e.titulo.includes(t));
  assert.equal(por("Registro mercantil").estado, "por_vencer", "faltan 10 días y avisa desde 60");
  assert.equal(por("Contrato de alquiler").estado, "vencido");
  assert.equal(por("Contrato de alquiler").fecha, "2026-09-01", "el vencido de antes de noviembre sigue saliendo");
  assert.equal(por("Estatutos sociales").estado, "por_vencer");
  assert.equal(por("B01").tipo, "comprobantes");
  assert.equal(por("B01").detalle, "Quedan 5");
  assert.equal(por("Certificado de firma de Patricia Paulino").tipo, "renovacion");
  assert.equal(ev.some((e) => e.titulo.includes("B02")), false, "diciembre no es noviembre");
  assert.equal(ev.some((e) => e.titulo.includes("Nombre comercial") || e.titulo.includes("Asamblea")), false, "fuera del mes y todavía vigentes");
  // En diciembre aparece la asamblea y el registro ya vencido sigue como atrasado.
  const dic = eventosDeEmpresa(d, CAL, [], "2026-12", "2026-12-01");
  assert.equal(dic.find((e) => e.titulo.includes("Asamblea")).estado, "por_vencer");
  assert.equal(dic.find((e) => e.titulo.includes("Registro mercantil")).estado, "vencido");
  assert.deepEqual(ev.map((e) => e.fecha), [...ev.map((e) => e.fecha)].sort(), "ordenadas por fecha");
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let firma, cliente, cal, usuario;
const leer = (empresa, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  process.env.DATABASE_URL = url;
  cal = await import("../lib/calendario-fiscal.ts");
  [{ id: usuario }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`cal-${marca}@x.do`}, 'Ana Calendario', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma calendario ${marca}`}) RETURNING id`;
  await sql`SELECT crear_calendario_fiscal(${firma})`;
  [{ id: cliente }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id, tiene_tss, vence_registro_mercantil, creada)
    VALUES ('Cliente Calendario SRL', '130000150', ${firma}, true, '2026-11-20', '2026-01-01') RETURNING id`;
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${usuario}`;
  } finally {
    await sql.end();
    const { db } = await import("../lib/db.ts");
    await db().end();
  }
});

test("el calendario de cada firma trae el anticipo con su día por confirmar y la TSS sin día", conBase, async () => {
  const filas = await sql`SELECT formato, dia, norma FROM calendario_fiscal WHERE firma_id = ${firma} ORDER BY formato`;
  assert.equal(filas.length, 8);
  assert.equal(filas.find((f) => f.formato === "TSS").dia, null);
  assert.match(filas.find((f) => f.formato === "TSS").norma, /Por confirmar/);
  assert.equal(filas.find((f) => f.formato === "Anticipo").dia, 15);
  await assert.rejects(() => sql`INSERT INTO calendario_fiscal (firma_id, formato, dia) VALUES (${firma}, 'Otro', 5)`, /check/i);
  await assert.rejects(() => sql`UPDATE calendario_fiscal SET dia = 40 WHERE firma_id = ${firma} AND formato = 'TSS'`, /check/i);
});

test("la fecha de la aplicación coincide con la de la base en todos los formatos, meses y prórrogas", conBase, async () => {
  await sql`UPDATE calendario_fiscal SET dia = 31 WHERE firma_id = ${firma} AND formato IN ('606', 'IT-1')`;
  await sql`INSERT INTO prorrogas_fiscales (firma_id, formato, periodo, vence, motivo) VALUES (${firma}, '607', '202610', '2026-11-23', 'Aviso de prueba')`;
  const calendario = await sql`SELECT formato, dia FROM calendario_fiscal WHERE firma_id = ${firma}`;
  const prorrogas = (await sql`SELECT formato, periodo, vence::text AS vence FROM prorrogas_fiscales WHERE firma_id = ${firma}`);
  let n = 0;
  for (const formato of ["606", "607", "608", "IT-1", "IR-17", "IR-2", "Anticipo"]) {
    for (let m = 1; m <= 12; m++) {
      const periodo = `2027${String(m).padStart(2, "0")}`;
      const [{ v }] = await leer(cliente, (tx) => tx`SELECT to_char(vencimiento_fiscal(${formato}, ${periodo}), 'YYYY-MM-DD') AS v`);
      assert.equal(fechaLimite(formato, periodo, calendario, prorrogas), v, `${formato} ${periodo}`);
      n++;
    }
  }
  const [{ v }] = await leer(cliente, (tx) => tx`SELECT to_char(vencimiento_fiscal('607', '202610'), 'YYYY-MM-DD') AS v`);
  assert.equal(v, "2026-11-23");
  assert.equal(fechaLimite("607", "202610", calendario, prorrogas), "2026-11-23");
  assert.equal(n, 84);
  await sql`UPDATE calendario_fiscal SET dia = 15 WHERE firma_id = ${firma} AND formato = '606'`;
  await sql`UPDATE calendario_fiscal SET dia = 20 WHERE firma_id = ${firma} AND formato = 'IT-1'`;
  await sql`DELETE FROM prorrogas_fiscales WHERE firma_id = ${firma}`;
});

test("el calendario de un cliente real junta declaraciones, registro mercantil, comprobantes y certificados", conBase, async () => {
  await leer(cliente, async (tx) => {
    await tx`INSERT INTO obligaciones_empresa (empresa_id, clave, activa) VALUES (${cliente}, 'f606', true), (${cliente}, 'it1', true), (${cliente}, 'anticipo', true)`;
    await tx`INSERT INTO envios_dgii (empresa_id, formato, periodo, en_cero, huella, registros, enviado_por) VALUES (${cliente}, '606', '202610', false, 'h', 1, ${usuario})`;
    await tx`INSERT INTO vencimientos_empresa (empresa_id, nombre, vence, avisar_dias) VALUES (${cliente}, 'Estatutos sociales', '2026-11-28', 30)`;
    await tx`INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence, activa) VALUES (${cliente}, 'B01', 1, 100, 96, '2026-11-30', true)`;
    await tx`INSERT INTO notificaciones_pago (empresa_id, tipo, periodo, concepto, monto, fecha_limite, estado, creado_por)
             VALUES (${cliente}, 'tss', '202610', 'TSS octubre', 1000, '2026-11-10', 'pagada', ${usuario})`;
  });
  await sql`UPDATE calendario_fiscal SET dia = 5 WHERE firma_id = ${firma} AND formato = 'TSS'`;
  const ev = await cal.calendarioDeFirma(firma, [{ id: cliente, nombre: "Cliente Calendario SRL", creada: "2026-11-01" }], "2026-11", "2026-11-10");
  const por = (t) => ev.find((e) => e.titulo.includes(t));
  assert.equal(por("606 de octubre").estado, "hecho", "ya está en envios_dgii");
  assert.equal(por("IT-1 de octubre").estado, "pendiente");
  assert.equal(por("IT-1 de octubre").enlace, `/e/${cliente}/dgii/it1?mes=2026-10`);
  assert.equal(por("Registro mercantil").estado, "por_vencer");
  assert.equal(por("Estatutos sociales").fecha, "2026-11-28");
  assert.equal(por("B01").detalle, "Quedan 5");
  assert.equal(por("Pago a la TSS").estado, "hecho", "su notificación está pagada");
  assert.equal(por("Anticipo").estado, "recordatorio");
  assert.ok(ev.every((e) => e.empresaId === cliente && e.fecha >= "2026-11-01" && e.fecha <= "2026-11-30"));
  // Otra firma no ve nada de este cliente ni su calendario.
  const otra = await cal.calendarioDeFirma(firma, [], "2026-11", "2026-11-10");
  assert.equal(otra.length, 0);
});
