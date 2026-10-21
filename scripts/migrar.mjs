// Aplica en orden las migraciones de /migraciones que falten. Uso: DATABASE_URL=... npm run migrar
// En Vercel corre antes de cada build (vercel-build), solo en producción.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
const enVercel = process.argv.includes("--vercel");
if (enVercel && process.env.VERCEL_ENV !== "production") {
  console.log("Vista previa: no se tocan las migraciones de la base de producción");
  process.exit(0);
}
if (!url) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "migraciones");

try {
  await sql`CREATE TABLE IF NOT EXISTS migraciones (nombre text PRIMARY KEY, aplicada timestamptz NOT NULL DEFAULT now())`;
  const hechas = new Set((await sql`SELECT nombre FROM migraciones`).map((r) => r.nombre));
  const archivos = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const archivo of archivos) {
    if (hechas.has(archivo)) continue;
    const texto = await readFile(path.join(dir, archivo), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(texto);
      await tx`INSERT INTO migraciones (nombre) VALUES (${archivo})`;
    });
    console.log(`Aplicada ${archivo}`);
  }
  console.log("Base de datos al día");
} finally {
  await sql.end();
}
