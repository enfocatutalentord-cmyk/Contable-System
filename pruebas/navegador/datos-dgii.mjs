// Datos de prueba para el recorrido de Reportes DGII (dgii.cjs), con la lógica real del sistema.
// Se ejecuta con node --experimental-strip-types (importa los módulos .ts de lib/).
import postgres from "postgres";
import { guardarBorradorCompra, registrarCompra, registrarPago } from "../../lib/compras.ts";
import { emitir, guardarBorradorFactura, registrarCobro } from "../../lib/ventas.ts";

export async function sembrar(empresa, correo) {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const [{ id: ana }] = await sql`SELECT id FROM usuarios WHERE email = ${correo}`;
    const leer = (fn) => sql.begin(async (tx) => {
      await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
      await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
      await tx`SET LOCAL ROLE contable_app`;
      return fn(tx);
    });
    return await leer(async (tx) => {
      const cuenta = async (c) => (await tx`SELECT id FROM cuentas WHERE codigo = ${c}`)[0].id;
      const imp = Object.fromEntries((await tx`SELECT id, nombre FROM impuestos`).map((r) => [r.nombre, r.id]));
      const ret = Object.fromEntries((await tx`SELECT id, nombre FROM retenciones`).map((r) => [r.nombre, r.id]));
      const [{ id: juan }] = await tx`INSERT INTO proveedores (empresa_id, nombre, tipo_identificacion, rnc) VALUES (${empresa}, 'Juan Pérez', 'cedula', '00100000001') RETURNING id`;
      const [{ id: sinRnc }] = await tx`INSERT INTO proveedores (empresa_id, nombre, tipo_identificacion, rnc) VALUES (${empresa}, 'Ferretería sin RNC', 'rnc', '101000003') RETURNING id`;
      const [{ id: cli }] = await tx`INSERT INTO clientes (empresa_id, nombre, tipo_identificacion, rnc) VALUES (${empresa}, 'Cliente SRL', 'rnc', '101000001') RETURNING id`;
      for (const t of ["B01", "B02", "B11"]) {
        await tx`INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence) VALUES (${empresa}, ${t}, 1, 100, 1, '2027-12-31')`;
      }
      const gasto = await cuenta("610205");
      const compra = async (proveedorId, ncf, fecha, precio) => {
        const id = await guardarBorradorCompra(tx, {
          empresaId: empresa, usuarioId: ana, proveedorId, tipo: "B01", ncf, fecha, vence: fecha, moneda: "DOP", tasa: 10000n,
          tipoGasto: "02", itbisAlCosto: false, notas: null,
          lineas: [{ descripcion: "Servicio", clase: "servicio", cantidad: 10000n, precio, cuentaId: gasto, impuestoIds: [imp["ITBIS 18 %"]] }],
        });
        await registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id });
        return id;
      };
      const c1 = await compra(juan, "B0100000777", "2026-10-02", 1000000n);
      await compra(sinRnc, "B0100000555", "2026-10-04", 200000n);
      // Después se le borró el RNC al proveedor: el 606 lo marca como error.
      await tx`UPDATE proveedores SET rnc = NULL, tipo_identificacion = NULL WHERE id = ${sinRnc}`;
      await registrarPago(tx, {
        empresaId: empresa, usuarioId: ana, proveedorId: juan, fecha: "2026-10-05", moneda: "DOP", tasa: 10000n, cuentaOrigenId: await cuenta("110103"),
        formaPago: "02", referencia: null, notas: null, pagado: 1180000n - 54000n - 150000n,
        retenciones: [{ retencionId: ret["ITBIS retenido 30 %"], monto: 54000n }, { retencionId: ret["ISR honorarios a personas físicas 15 %"], monto: 150000n }],
        aplicaciones: [{ compraId: c1, monto: 1180000n }],
      });
      const fid = await guardarBorradorFactura(tx, {
        empresaId: empresa, usuarioId: ana, clienteId: cli, tipo: "B01", fecha: "2026-10-06", vence: "2026-11-05", moneda: "DOP", tasa: 10000n, notas: null,
        tipoIngreso: "01", lineas: [{ servicioId: null, descripcion: "Asesoría", cantidad: 10000n, precio: 500000n, impuestoIds: [imp["ITBIS 18 %"]] }],
      });
      const { ncf } = await emitir(tx, { empresaId: empresa, usuarioId: ana, facturaId: fid });
      await registrarCobro(tx, {
        empresaId: empresa, usuarioId: ana, clienteId: cli, fecha: "2026-10-15", moneda: "DOP", tasa: 10000n, cuentaDestinoId: await cuenta("110103"),
        formaPago: "transferencia", referencia: null, notas: null, recibido: 590000n, retenciones: [], aplicaciones: [{ facturaId: fid, monto: 590000n }],
      });
      return { ncfFactura: ncf };
    });
  } finally {
    await sql.end();
  }
}
