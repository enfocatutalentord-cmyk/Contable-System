// Prioridad 1.1 del prompt de Patricia (20-nov-2026): sus tres empresas llevan contabilidad completa y no son clientes. Empire es la
// que factura a los clientes de la firma; las otras propias tienen contabilidad pero no igualas ni lo de la socia.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { PESTANAS_CONTABLES, pestanasEn, PESTANAS_SOLO_PROPIA } from "../lib/pestanas.ts";

test("otra empresa propia: contabilidad completa, sin lo que solo es de Empire", () => {
  const otra = pestanasEn(null, false, true);
  for (const r of PESTANAS_CONTABLES) assert.ok(otra.includes(r), r);
  for (const r of PESTANAS_SOLO_PROPIA) assert.ok(!otra.includes(r), r);
  assert.equal(pestanasEn(null, true, true), null, "Empire ve todo");
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
let firma, empire, rojas, cliente;

before(async () => {
  if (!sql) return;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma contabilidad propia ${Date.now()}`}) RETURNING id`;
  const nueva = async (nombre) => (await sql`INSERT INTO empresas (firma_id, nombre) VALUES (${firma}, ${nombre}) RETURNING id`)[0].id;
  empire = await nueva("Empire Tax'N Legal SRL");
  rojas = await nueva("Rojas Investment Group GR SRL");
  cliente = await nueva("Cliente Uno SRL");
});

after(async () => {
  if (!sql) return;
  try {
    if (firma) {
      await sql`UPDATE firmas SET empresa_propia_id = NULL WHERE id = ${firma}`;
      await sql`DELETE FROM empresas WHERE id = ${empire}`; // primero la que factura: los demás son clientes en su facturación
      await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
      await sql`DELETE FROM firmas WHERE id = ${firma}`;
    }
  } finally { await sql.end(); }
});

test("la que factura queda como propia sola, y una propia lleva contabilidad aunque no esté marcada en la ficha", conBase, async () => {
  await sql`UPDATE firmas SET empresa_propia_id = ${empire} WHERE id = ${firma}`;
  const [e] = await sql`SELECT contabilidad_propia, lleva_contabilidad FROM empresas WHERE id = ${empire}`;
  assert.deepEqual({ ...e }, { contabilidad_propia: true, lleva_contabilidad: true });
  await sql`UPDATE empresas SET contabilidad_propia = true WHERE id = ${rojas}`;
  const [{ r, c }] = await sql`SELECT lleva_contabilidad(${rojas}) AS r, lleva_contabilidad(${cliente}) AS c`;
  assert.equal(r, true);
  assert.equal(c, false, "a los clientes no se les lleva contabilidad");
  const lista = await sql`
    SELECT e.nombre, e.contabilidad_propia AS propia, e.id IS NOT DISTINCT FROM f.empresa_propia_id AS empire
      FROM empresas e JOIN firmas f ON f.id = e.firma_id WHERE e.firma_id = ${firma} ORDER BY e.nombre`;
  assert.deepEqual(lista.filter((x) => !x.propia).map((x) => x.nombre), ["Cliente Uno SRL"], "la lista de clientes no trae las propias");
  assert.deepEqual(lista.filter((x) => x.empire).map((x) => x.nombre), ["Empire Tax'N Legal SRL"]);
});
