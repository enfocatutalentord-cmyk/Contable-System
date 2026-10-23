// Límite de intentos de entrada. Necesita DATABASE_URL.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import postgres from "postgres";
import { anotarIntento, entradaBloqueada, MAX_POR_CORREO, MAX_POR_IP } from "../lib/intentos.ts";

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
const correo = (n) => `intentos-${marca}-${n}@x.do`;
const ip = `10.${marca % 250}.0.1`;

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM intentos_entrada WHERE email LIKE ${`intentos-${marca}-%`}`;
  } finally {
    await sql.end();
  }
});

test("tras 5 intentos fallidos el correo queda bloqueado; un acierto antes reinicia la cuenta", conBase, async () => {
  for (let i = 0; i < MAX_POR_CORREO - 1; i++) await anotarIntento(sql, correo(1), null, false);
  assert.equal(await entradaBloqueada(sql, correo(1), null), false);
  await anotarIntento(sql, correo(1), null, true);
  await anotarIntento(sql, correo(1), null, false);
  assert.equal(await entradaBloqueada(sql, correo(1), null), false, "el acierto reinicia");
  for (let i = 0; i < MAX_POR_CORREO; i++) await anotarIntento(sql, correo(2), null, false);
  assert.equal(await entradaBloqueada(sql, correo(2), null), true);
  assert.equal(await entradaBloqueada(sql, correo(3), null), false, "otro correo no queda bloqueado");
});

test("los fallos de hace más de 15 minutos no cuentan", conBase, async () => {
  for (let i = 0; i < MAX_POR_CORREO; i++) {
    await sql`INSERT INTO intentos_entrada (email, exito, fecha) VALUES (${correo(4)}, false, now() - interval '20 minutes')`;
  }
  assert.equal(await entradaBloqueada(sql, correo(4), null), false);
});

test("muchos fallos desde la misma dirección bloquean esa dirección aunque cambie el correo", conBase, async () => {
  for (let i = 0; i < MAX_POR_IP; i++) await anotarIntento(sql, correo(`ip${i}`), ip, false);
  assert.equal(await entradaBloqueada(sql, correo("nuevo"), ip), true);
  assert.equal(await entradaBloqueada(sql, correo("nuevo"), "10.255.255.255"), false);
});

test("el rol de la app no puede leer los intentos", conBase, async () => {
  await assert.rejects(sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE contable_app`;
    await tx`SELECT count(*) FROM intentos_entrada`;
  }), /permission denied/);
});
