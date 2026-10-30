// Datos de muestra para el video demo: dos clientes ficticios de la firma con ventas, cobros, compras, pagos con
// retenciones y documentos subidos por el cliente, creados con la lógica real del sistema.
// Uso (después de crear la firma y los clientes en la app): node --experimental-strip-types datos.mjs <correo> <empresaId>...
import { createHash } from "node:crypto";
import postgres from "postgres";
import { guardarBorradorCompra, registrarCompra, registrarPago } from "../../../lib/compras.ts";
import { emitir, guardarBorradorFactura, registrarCobro } from "../../../lib/ventas.ts";

// PNG de 1×1 (gris) para los documentos de muestra; cambia un byte para que cada archivo sea distinto.
const png = (n) => Buffer.from(`89504e470d0a1a0a0000000d4948445200000001000000010800000000376ef9240000000a49444154789c63${(0x60 + n).toString(16)}000000020001e221bc330000000049454e44ae426082`, "hex");

async function sembrar(sql, empresa, usuario, i) {
  const leer = (fn) => sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    await tx`SELECT set_config('app.usuario_id', ${usuario}, true)`;
    await tx`SET LOCAL ROLE contable_app`;
    return fn(tx);
  });
  await leer(async (tx) => {
    const cuenta = async (c) => (await tx`SELECT id FROM cuentas WHERE codigo = ${c}`)[0].id;
    const imp = Object.fromEntries((await tx`SELECT id, nombre FROM impuestos`).map((r) => [r.nombre, r.id]));
    const ret = Object.fromEntries((await tx`SELECT id, nombre FROM retenciones`).map((r) => [r.nombre, r.id]));
    const ins = async (tabla, datos) => (await tx`INSERT INTO ${tx(tabla)} ${tx({ empresa_id: empresa, ...datos })} RETURNING id`)[0].id;
    const cli = [
      await ins("clientes", { nombre: i ? "Hotel Brisas del Este SRL" : "Constructora Horizonte SRL", tipo_identificacion: "rnc", rnc: i ? "101000021" : "101000011", dias_credito: 30 }),
      await ins("clientes", { nombre: i ? "Agencia Viajes Caribe SRL" : "Inversiones Altamira SRL", tipo_identificacion: "rnc", rnc: i ? "101000022" : "101000012", dias_credito: 15 }),
      await ins("clientes", { nombre: "Consumidor final", dias_credito: 0 }),
    ];
    const prov = [
      await ins("proveedores", { nombre: "Suministros Oficina Express SRL", tipo_identificacion: "rnc", rnc: "101000031" }),
      await ins("proveedores", { nombre: "Ana Martínez (consultora)", tipo_identificacion: "cedula", rnc: "00100000002" }),
      await ins("proveedores", { nombre: "Energía y Luz del Este SA", tipo_identificacion: "rnc", rnc: "101000032" }),
    ];
    for (const t of ["B01", "B02", "B04", "B11"]) {
      await tx`INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence) VALUES (${empresa}, ${t}, 1, 500, 1, '2027-12-31')`;
    }
    const banco = await cuenta("110103"), gasto = await cuenta("610205");
    const linea = (descripcion, precio, impuesto = "ITBIS 18 %") => ({ servicioId: null, descripcion, cantidad: 10000n, precio, impuestoIds: [imp[impuesto]] });
    const factura = async (clienteId, tipo, fecha, vence, lineas, emitirla = true) => {
      const id = await guardarBorradorFactura(tx, { empresaId: empresa, usuarioId: usuario, clienteId, tipo, fecha, vence, moneda: "DOP", tasa: 10000n, notas: null, lineas });
      if (emitirla) await emitir(tx, { empresaId: empresa, usuarioId: usuario, facturaId: id });
      return id;
    };
    const f1 = await factura(cli[0], "B01", "2026-10-03", "2026-11-02", [linea(i ? "Asesoría fiscal mensual" : "Contabilidad mensual", 4500000n), linea("Libros y formularios", 300000n, "Exento")]);
    const f2 = await factura(cli[1], "B01", "2026-10-10", "2026-10-25", [linea("Auditoría de inventario", 8500000n)]);
    await factura(cli[2], "B02", "2026-10-15", "2026-10-15", [linea("Consulta tributaria", 350000n)]);
    await factura(cli[0], "B01", "2026-09-05", "2026-10-05", [linea("Declaraciones del mes", 2800000n)]); // vencida
    await factura(cli[1], "B01", "2026-10-28", "2026-11-27", [linea("Nómina y TSS", 1500000n)], false); // borrador
    await registrarCobro(tx, { empresaId: empresa, usuarioId: usuario, clienteId: cli[0], fecha: "2026-10-20", moneda: "DOP", tasa: 10000n,
      cuentaDestinoId: banco, formaPago: "transferencia", referencia: "TR-4471", notas: null, recibido: 5610000n, retenciones: [],
      aplicaciones: [{ facturaId: f1, monto: 5610000n }] });
    await registrarCobro(tx, { empresaId: empresa, usuarioId: usuario, clienteId: cli[1], fecha: "2026-10-27", moneda: "DOP", tasa: 10000n,
      cuentaDestinoId: banco, formaPago: "cheque", referencia: "CK-0912", notas: null, recibido: 5000000n, retenciones: [],
      aplicaciones: [{ facturaId: f2, monto: 5000000n }] });
    const compra = async (proveedorId, ncf, fecha, tipoGasto, descripcion, precio, clase = "servicio") => {
      const id = await guardarBorradorCompra(tx, { empresaId: empresa, usuarioId: usuario, proveedorId, tipo: "B01", ncf, fecha, vence: fecha,
        moneda: "DOP", tasa: 10000n, tipoGasto, itbisAlCosto: false, notas: null,
        lineas: [{ descripcion, clase, cantidad: 10000n, precio, cuentaId: gasto, impuestoIds: [imp["ITBIS 18 %"]] }] });
      await registrarCompra(tx, { empresaId: empresa, usuarioId: usuario, compraId: id });
      return id;
    };
    await compra(prov[0], `B01000${i}0141`, "2026-10-04", "02", "Papelería y tóner", 1250000n, "bien");
    const c2 = await compra(prov[1], `B01000${i}0077`, "2026-10-08", "02", "Consultoría en procesos", 6000000n);
    await compra(prov[2], `B01000${i}5530`, "2026-10-12", "02", "Energía eléctrica de octubre", 980000n);
    // Pago a la consultora con retenciones: 30 % del ITBIS (3,240) e ISR 15 % (9,000) que se pagan a la DGII.
    await registrarPago(tx, { empresaId: empresa, usuarioId: usuario, proveedorId: prov[1], fecha: "2026-10-22", moneda: "DOP", tasa: 10000n,
      cuentaOrigenId: banco, formaPago: "02", referencia: "TR-8810", notas: null, pagado: 7080000n - 324000n - 900000n,
      retenciones: [{ retencionId: ret["ITBIS retenido 30 %"], monto: 324000n }, { retencionId: ret["ISR honorarios a personas físicas 15 %"], monto: 900000n }],
      aplicaciones: [{ compraId: c2, monto: 7080000n }] });
    for (const [n, nombre, categoria, nota] of [[1, "recibo-gasolina-octubre.png", "gasto", "Gasolina del vehículo de la empresa"], [2, "factura-ferreteria.png", "factura_recibida", "Factura de materiales del día 25"]]) {
      const c = png(n + i * 2);
      await tx`INSERT INTO recepciones (empresa_id, categoria, nombre, tipo, tamano, sha256, contenido, nota, subido_por)
               VALUES (${empresa}, ${categoria}, ${nombre}, 'image/png', ${c.length}, ${createHash("sha256").update(c).digest("hex")}, ${c}, ${nota}, ${usuario})`;
    }
  });
  await sql`UPDATE empresas SET responsable_id = ${usuario} WHERE id = ${empresa}`;
}

const [correo, ...empresas] = process.argv.slice(2);
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const [{ id }] = await sql`SELECT id FROM usuarios WHERE email = ${correo}`;
  for (const [i, e] of empresas.entries()) await sembrar(sql, e, id, i);
  console.log("datos de muestra listos");
} finally {
  await sql.end();
}
