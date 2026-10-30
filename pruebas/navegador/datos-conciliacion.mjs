// Datos de prueba para el recorrido de la conciliación (conciliacion.cjs), con la lógica real del sistema: un cobro con
// referencia, dos cobros que el banco deposita juntos y una compra por pagar. Se ejecuta con --experimental-strip-types.
import postgres from "postgres";
import { guardarBorradorCompra, registrarCompra } from "../../lib/compras.ts";
import { emitir, guardarBorradorFactura, registrarCobro } from "../../lib/ventas.ts";

export async function sembrar(empresa, correo) {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const [{ id: ana }] = await sql`SELECT id FROM usuarios WHERE email = ${correo}`;
    return await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
      await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
      await tx`SET LOCAL ROLE contable_app`;
      const cuenta = async (c) => (await tx`SELECT id FROM cuentas WHERE codigo = ${c}`)[0].id;
      const banco = await cuenta("110103");
      const imp = Object.fromEntries((await tx`SELECT id, nombre FROM impuestos`).map((r) => [r.nombre, r.id]));
      const [{ id: cli }] = await tx`INSERT INTO clientes (empresa_id, nombre, tipo_identificacion, rnc) VALUES (${empresa}, 'Cliente SRL', 'rnc', '101000001') RETURNING id`;
      const [{ id: prov }] = await tx`INSERT INTO proveedores (empresa_id, nombre, tipo_identificacion, rnc) VALUES (${empresa}, 'Ferretería Los Robles', 'rnc', '101000003') RETURNING id`;
      for (const t of ["B01"]) await tx`INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence) VALUES (${empresa}, ${t}, 1, 100, 1, '2027-12-31')`;
      const factura = async (fecha, precio) => {
        const id = await guardarBorradorFactura(tx, {
          empresaId: empresa, usuarioId: ana, clienteId: cli, tipo: "B01", fecha, vence: fecha, moneda: "DOP", tasa: 10000n, notas: null,
          tipoIngreso: "01", lineas: [{ servicioId: null, descripcion: "Servicio", cantidad: 10000n, precio, impuestoIds: [imp["Exento"]] }],
        });
        await emitir(tx, { empresaId: empresa, usuarioId: ana, facturaId: id });
        return id;
      };
      const cobro = async (fecha, facturaId, monto, referencia) => registrarCobro(tx, {
        empresaId: empresa, usuarioId: ana, clienteId: cli, fecha, moneda: "DOP", tasa: 10000n, cuentaDestinoId: banco, formaPago: "transferencia",
        referencia, notas: null, recibido: monto, retenciones: [], aplicaciones: [{ facturaId, monto }],
      });
      await cobro("2026-10-01", await factura("2026-10-01", 2000000n), 2000000n, "55501");
      await cobro("2026-10-04", await factura("2026-10-04", 100000n), 100000n, null);
      await cobro("2026-10-04", await factura("2026-10-04", 250000n), 250000n, null);
      const compra = await guardarBorradorCompra(tx, {
        empresaId: empresa, usuarioId: ana, proveedorId: prov, tipo: "B01", ncf: "B0100000901", fecha: "2026-10-01", vence: "2026-10-31", moneda: "DOP",
        tasa: 10000n, tipoGasto: "02", itbisAlCosto: false, notas: null,
        lineas: [{ descripcion: "Materiales", clase: "bien", cantidad: 10000n, precio: 500000n, cuentaId: await cuenta("610214"), impuestoIds: [imp["Exento"]] }],
      });
      await registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: compra });
    });
  } finally {
    await sql.end();
  }
}
