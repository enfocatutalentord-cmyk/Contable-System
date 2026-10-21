import { CATALOGO_RD, TIPO_POR_CLASE, nivelDeCodigo } from "./catalogo-rd";
import { db, type Tx } from "./db";

export function rncValido(rnc: string): boolean {
  return /^\d{9}$/.test(rnc) || /^\d{11}$/.test(rnc);
}

export function limpiarRnc(rnc: string | null | undefined): string {
  return (rnc ?? "").replace(/[-\s]/g, "");
}

// Crea la empresa, deja a quien la crea como dueño y le carga el catálogo de cuentas dominicano.
export async function crearEmpresa(
  datos: { nombre: string; rnc: string | null; usuarioId: string },
  tx?: Tx,
): Promise<string> {
  const correr = async (t: Tx) => {
    const [{ id }] = await t<{ id: string }[]>`
      INSERT INTO empresas (nombre, rnc) VALUES (${datos.nombre}, ${datos.rnc}) RETURNING id`;
    await t`SELECT set_config('app.empresa_id', ${id}, true)`;
    await t`INSERT INTO miembros (empresa_id, usuario_id, rol) VALUES (${id}, ${datos.usuarioId}, 'dueno')`;
    await cargarCatalogo(t, id);
    await t`SELECT configurar_cuentas_empresa(${id})`;
    await t`INSERT INTO bitacora (empresa_id, usuario_id, accion) VALUES (${id}, ${datos.usuarioId}, 'empresa_creada')`;
    return id;
  };
  return tx ? correr(tx) : (db().begin(correr) as Promise<string>);
}

async function cargarCatalogo(tx: Tx, empresaId: string): Promise<void> {
  const ids = new Map<string, string>();
  for (const [codigo, nombre] of CATALOGO_RD) {
    const padre = codigoPadre(codigo);
    const [{ id }] = await tx<{ id: string }[]>`
      INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
      VALUES (${empresaId}, ${codigo}, ${nombre}, ${TIPO_POR_CLASE[codigo[0]]},
              ${padre ? ids.get(padre)! : null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6})
      RETURNING id`;
    ids.set(codigo, id);
  }
}

export function codigoPadre(codigo: string): string | null {
  if (codigo.length === 1) return null;
  if (codigo.length === 2) return codigo.slice(0, 1);
  return codigo.slice(0, codigo.length - 2);
}
