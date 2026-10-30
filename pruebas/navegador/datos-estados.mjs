// Datos de prueba para el recorrido de estados financieros (estados.cjs): capital, ventas, costo, gastos e ISR de 2025 y
// 2026, con la lógica real de asientos. Se ejecuta con --experimental-strip-types.
import postgres from "postgres";
import { insertarAsiento } from "../../lib/asientos.ts";

export async function sembrar(empresa, correo) {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const [{ id: ana }] = await sql`SELECT id FROM usuarios WHERE email = ${correo}`;
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
      await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
      await tx`SET LOCAL ROLE contable_app`;
      const id = async (c) => (await tx`SELECT id FROM cuentas WHERE codigo = ${c}`)[0].id;
      const a = async (fecha, debe, haber, monto) => insertarAsiento(tx, {
        empresaId: empresa, usuarioId: ana, fecha, concepto: `Prueba ${debe}/${haber}`, origen: "manual",
        lineas: [{ cuentaId: await id(debe), debe: monto, haber: 0n }, { cuentaId: await id(haber), debe: 0n, haber: monto }],
      });
      await a("2025-06-01", "110103", "310101", 10000000n);
      await a("2025-11-10", "110103", "410101", 500000n);
      await a("2026-03-05", "110103", "410101", 5000000n);
      await a("2026-03-06", "510101", "110103", 2000000n);
      await a("2026-03-07", "610214", "110103", 1000000n);
      await a("2026-03-08", "620101", "110103", 100000n);
      await a("2026-03-31", "630101", "210205", 300000n);
    });
  } finally {
    await sql.end();
  }
}
