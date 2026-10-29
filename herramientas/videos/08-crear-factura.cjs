const { abrir } = require("./guion.cjs");
// Correo del usuario de prueba creado por pruebas/navegador/ventas.cjs (cambiarlo por el de la base local).
const CORREO = process.env.CORREO || "ventas-1793203016716@firma.do";
(async () => {
  const t = await abrir("08", process.argv[2] + "/tmp");
  const { page } = t;
  await t.entrar(CORREO);
  await t.tarjeta("Crear y emitir una factura", "Ventas › Facturas");
  await t.sub("Al entrar ves el <b>Panel de la firma</b> con tus clientes.", 2600);
  await t.clic(page.locator("table a strong").first(), "Toca el <b>nombre del cliente</b> para abrir su menú.");
  await t.clic(page.locator("nav a", { hasText: /^Facturas$/ }), "En el menú, entra a <b>Ventas › Facturas</b>.");
  await t.clic(page.getByRole("link", { name: "+ Nueva factura" }), "Toca <b>+ Nueva factura</b>.", 1200);
  await t.elegir(page.locator("select[name=cliente]"), { label: "Banco Caribe SA · 101000001" }, "Elige el <b>cliente</b>. Sus datos fiscales se completan solos.");
  await t.sub("El <b>tipo de comprobante</b>, la fecha y el vencimiento se proponen según el cliente.", 3000);
  await t.elegir(page.getByLabel("Producto de la línea 1"), { label: "Reclutamiento gerencial" }, "En la línea, elige un <b>producto o servicio</b>: trae su precio e impuesto.");
  await t.escribir(page.getByLabel("Cantidad de la línea 1"), "2", "Ajusta la <b>cantidad</b>.");
  await t.señalar(page.locator("tfoot").last(), "El sistema calcula el <b>subtotal, el ITBIS y el total</b> mientras escribes.");
  await t.espera(1400); await t.soltar();
  await t.clic(page.getByRole("button", { name: "Guardar borrador" }), "Toca <b>Guardar borrador</b>. Todavía no tiene NCF ni asiento: se puede editar.", 1500);
  await t.sub("Es un <b>borrador</b>: puedes revisarlo, editarlo o descartarlo.", 3000);
  await t.clic(page.getByRole("button", { name: "Emitir factura" }), "Cuando esté correcta, toca <b>Emitir factura</b>.", 1500);
  await t.sub("Listo: la factura tomó su <b>NCF</b> y se <b>contabilizó sola</b>.", 3200);
  await t.señalar(page.getByText("Imprimir o guardar PDF", { exact: true }), "Desde aquí la <b>imprimes o guardas en PDF</b> para enviarla al cliente.");
  await t.soltar();
  await t.señalar(page.getByText("Registrar cobro", { exact: true }).first(), "Y cuando el cliente pague, registras el <b>cobro</b> desde la misma factura.");
  await t.soltar(); await t.sub("", 0);
  await t.tarjeta("¡Factura emitida!", "Siguiente video: Registrar un cobro", 3000);
  await t.cerrar(process.argv[2] + "/08-crear-factura.webm");
})().catch((e) => { console.error(e); process.exit(1); });
