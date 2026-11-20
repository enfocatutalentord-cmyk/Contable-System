import { accesoFirma, esUuid } from "./acceso";
import { conEmpresa, db } from "./db";
import { crearEmpresa, leerFicha } from "./empresas";
import { abrirConstitucion } from "./tramites";

// Prioridad 2.2 (P2c.2): alta rápida de un cliente desde cualquier pantalla de trabajo (Trámites, Solicitudes, Levantamiento, Facturas del
// cliente…). El formulario trae «empresa» (el cliente elegido o «nuevo») y, si es nuevo, su nombre y su RNC o cédula si lo tiene; con
// «en constitución» queda con nombre provisional y sin RNC. Quien lo crea sin ser administradora queda como su responsable.

export class ErrorClienteRapido extends Error {
  code = "P0001"; // mensajeError lo muestra tal cual
}

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();

export async function clienteDeFormulario(firmaId: string, fd: FormData): Promise<{ id: string; nuevo: boolean }> {
  const { usuario, firma } = await accesoFirma(firmaId, false);
  const elegido = texto(fd, "empresa");
  if (elegido && elegido !== "nuevo") {
    if (!esUuid(elegido)) throw new ErrorClienteRapido("Elige el cliente.");
    return { id: elegido, nuevo: false };
  }
  if (!firma.crear_clientes) throw new ErrorClienteRapido("Crear clientes no está entre tus permisos: elige uno de la lista.");
  const enConstitucion = fd.get("cliente_constitucion") === "on";
  const datos = new FormData();
  datos.set("nombre", texto(fd, "cliente_nombre"));
  const rnc = texto(fd, "cliente_rnc").replace(/[-\s]/g, "");
  datos.set("tipo_identificacion", rnc.length === 11 ? "cedula" : "rnc");
  datos.set("rnc", rnc);
  if (enConstitucion) datos.set("en_constitucion", "on");
  const ficha = leerFicha(datos);
  if (typeof ficha === "string") throw new ErrorClienteRapido(ficha === "Escribe la razón social o el nombre de la empresa." ? "Elige el cliente o escribe el nombre del nuevo." : ficha);
  const id = await crearEmpresa({ firmaId, usuarioId: usuario.id, ficha });
  if (ficha.provisional) await conEmpresa(id, (tx) => abrirConstitucion(tx, id));
  if (!firma.administrador) {
    await db()`UPDATE empresas SET responsable_id = COALESCE(responsable_id, ${usuario.id}) WHERE id = ${id}`;
    await db()`UPDATE miembros_firma SET clientes = array_append(clientes, ${id}::uuid)
                WHERE firma_id = ${firmaId} AND usuario_id = ${usuario.id} AND alcance = 'elegidos' AND NOT (${id}::uuid = ANY (clientes))`;
  }
  return { id, nuevo: true };
}
