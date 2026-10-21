import postgres from "postgres";

export type Tx = postgres.TransactionSql;

const global = globalThis as unknown as { _sql?: postgres.Sql };

// Conexión con el usuario dueño de la base. Solo para lo que no pertenece a una empresa
// (registro, sesiones, «mis empresas»). Todo lo contable va por conEmpresa().
export function db(): postgres.Sql {
  if (!global._sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL");
    // prepare: false para funcionar detrás del pooler de Neon (modo transacción).
    global._sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} });
  }
  return global._sql;
}

// Corre fn dentro de una transacción atada a una empresa: la base solo deja ver y escribir sus datos.
export async function conEmpresa<T>(empresaId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${empresaId}, true)`;
    await tx`SET LOCAL ROLE contable_app`;
    return fn(tx);
  }) as Promise<T>;
}

// Mensaje legible para errores que vienen de las reglas de la base.
export function mensajeError(e: unknown): string {
  if (e && typeof e === "object" && "code" in e) {
    const err = e as { code?: string; message?: string; constraint_name?: string };
    if (err.code === "23514" || err.code === "P0001") return err.message ?? "Operación no válida";
    if (err.code === "23505") return "Ya existe un registro con ese código";
  }
  console.error(e);
  return "No se pudo completar la operación. Intenta de nuevo.";
}
