// Recorrido en el navegador de compras y cuentas por pagar (fase 4). Crea su propia firma.
// Uso: npm run build && npx next start -p 3100, luego: node pruebas/navegador/compras.cjs
// PLAYWRIGHT=ruta/a/playwright si no está instalado en el proyecto; BASE=url de la app; CAPTURAS=carpeta de capturas.
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const path = require("node:path");
const fs = require("node:fs");
const S = process.env.CAPTURAS || "/tmp", B = process.env.BASE || "http://localhost:3100";
const assert = (c, m) => { if (!c) throw new Error(m); };
fs.mkdirSync(S, { recursive: true });
fs.writeFileSync(path.join(S, "factura-proveedor.pdf"), "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => m.type() === "error" && errores.push(m.text()));
  const paso = (t) => console.log("✓", t);
  const ver = (texto) => page.waitForSelector(`text=${texto}`, { timeout: 15000 });
  const ir = (url) => page.goto(url, { waitUntil: "networkidle" });
  const boton = (nombre) => page.getByRole("button", { name: nombre, exact: true }).click();
  // Descarga el Excel de una lista con su botón y devuelve las filas de la hoja (exceljs del proyecto).
  const excelDe = async (url) => {
    await ir(url);
    const [d] = await Promise.all([page.waitForEvent("download"), page.locator(".descargar a", { hasText: "Excel" }).click()]);
    const ExcelJS = require(path.join(process.cwd(), "node_modules/exceljs"));
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.readFile(await d.path());
    const filas = [];
    libro.worksheets[0].eachRow((r) => filas.push(r.values.slice(1)));
    return { nombre: d.suggestedFilename(), filas };
  };
  const captura = (n) => page.screenshot({ path: path.join(S, n), fullPage: true });
  const asiento = async () => {
    await page.click("text=Ver asiento");
    await page.waitForURL(/asientos\/[0-9a-f-]+$/);
    return page.locator("tbody").first().innerText();
  };

  // 1. Firma y empresa
  await ir(B + "/registro");
  await page.fill("input[name=nombre]", "Joannie");
  await page.fill("input[name=email]", `compras-${Date.now()}@firma.do`);
  await page.fill("input[name=clave]", "clave-segura-123");
  await page.fill("input[name=firma]", "Firma Compras SRL");
  await page.click("button.primario");
  await page.waitForURL(/\/firma\/[0-9a-f-]+$/);
  await page.click("text=+ Nuevo cliente");
  await page.fill("input[name=nombre]", "Distribuidora Prueba SRL");
  await page.fill("input[name=rnc]", "101000010");
  await page.click("text=Crear cliente");
  await page.waitForURL(/\/e\/[0-9a-f-]+$/);
  const base = page.url();
  paso("firma y empresa creadas");

  // 2. Proveedores
  await ir(base + "/proveedores");
  await page.fill("input[name=nombre]", "Abogados Asociados SRL");
  await page.selectOption("select[name=tipo_identificacion]", "rnc");
  await page.fill("input[name=rnc]", "101-00000-2");
  await page.selectOption("select[name=tipo_gasto]", "02");
  await page.selectOption("select[name=cuenta_gasto]", { label: "610205 · Honorarios profesionales" });
  await page.locator("label", { hasText: "ITBIS retenido 30 %" }).locator("input").check();
  await boton("Guardar proveedor");
  await ver("Proveedor Abogados Asociados SRL guardado.");
  await page.fill("input[name=nombre]", "Juan Pérez");
  await page.selectOption("select[name=tipo_identificacion]", "cedula");
  await page.fill("input[name=rnc]", "001-0000000-1");
  await page.selectOption("select[name=tipo_gasto]", "02");
  await page.selectOption("select[name=cuenta_gasto]", { label: "610208 · Mantenimiento y reparaciones" });
  await page.locator("label", { hasText: "ITBIS retenido 30 %" }).locator("input").uncheck();
  await boton("Guardar proveedor");
  await ver("Proveedor Juan Pérez guardado.");
  await page.fill("input[name=nombre]", "Colmado La Esquina");
  await page.fill("input[name=rnc]", "");
  await page.selectOption("select[name=tipo_gasto]", "05");
  await page.selectOption("select[name=cuenta_gasto]", { label: "610214 · Otros gastos" });
  await boton("Guardar proveedor");
  await ver("Proveedor Colmado La Esquina guardado.");
  paso("proveedores con RNC, cédula y sin identificación, con su gasto 606, cuenta y retención habitual");

  // 3. Compra B01: borrador y luego registrada
  await ir(base + "/compras/nueva");
  await page.selectOption("select[name=proveedor]", { label: "Abogados Asociados SRL · 101000002" });
  assert((await page.locator("select[name=tipo]").inputValue()) === "B01", "sugiere B01 con RNC");
  assert((await page.locator("select[name=tipo_gasto]").inputValue()) === "02", "tipo de gasto habitual");
  await page.fill("input[name=ncf]", "b0100000123");
  await page.fill("input[name=fecha]", "2026-10-03");
  await page.getByLabel("Descripción de la línea 1").fill("Honorarios legales de octubre");
  await page.getByLabel("Precio de la línea 1").fill("10,000");
  assert((await page.locator("tfoot tr").last().innerText()).includes("11,800.00"), "total en vista previa");
  await captura("c-compra-nueva.png");
  await boton("Guardar borrador");
  await page.waitForURL(/compras\/[0-9a-f-]+\?guardada=1/);
  const urlCompra = page.url().split("?")[0];
  await ver("Borrador guardado");
  await boton("Registrar compra");
  await page.waitForURL(/\?registrada=1/);
  await ver("Compra registrada con NCF B0100000123");
  await page.setInputFiles("input[name=archivo]", path.join(S, "factura-proveedor.pdf"));
  await page.fill("input[name=descripcion]", "Factura del proveedor escaneada");
  await boton("Adjuntar");
  await ver("Documento adjuntado.");
  await captura("c-compra-registrada.png");
  const a1 = await asiento();
  assert(a1.includes("610205") && a1.includes("10,000.00") && a1.includes("110401") && a1.includes("1,800.00") && a1.includes("210101") && a1.includes("11,800.00"), "asiento de la compra: " + a1);
  paso("compra B0100000123: honorarios 10,000 + ITBIS pagado 1,800 contra cuentas por pagar 11,800; factura adjunta");

  // 4. NCF duplicado
  await ir(base + "/compras/nueva");
  await page.selectOption("select[name=proveedor]", { label: "Abogados Asociados SRL · 101000002" });
  await page.fill("input[name=ncf]", "B0100000123");
  await page.getByLabel("Descripción de la línea 1").fill("Otra vez");
  await page.getByLabel("Precio de la línea 1").fill("100");
  await boton("Guardar borrador");
  await ver("Ya registraste el NCF B0100000123 de este proveedor");
  paso("el mismo NCF del mismo proveedor se rechaza");

  // 5. Consumo B02: ITBIS al gasto
  await ir(base + "/compras/nueva");
  await page.selectOption("select[name=proveedor]", { label: "Colmado La Esquina" });
  assert((await page.locator("select[name=tipo]").inputValue()) === "B02", "sugiere B02 sin identificación");
  await page.fill("input[name=ncf]", "B0200000777");
  await page.fill("input[name=fecha]", "2026-10-04");
  await page.getByLabel("Descripción de la línea 1").fill("Almuerzo con cliente");
  await page.getByLabel("Precio de la línea 1").fill("1000");
  await ver("no da crédito de ITBIS");
  await boton("Registrar compra");
  await page.waitForURL(/\?registrada=1/);
  const a2 = await asiento();
  assert(a2.includes("610214") && a2.includes("1,180.00") && !a2.includes("110401"), "B02 al gasto: " + a2);
  paso("consumo B02: el ITBIS va al gasto (1,180) sin crédito fiscal");

  // 6. B11 a persona física: necesita nuestro rango
  await ir(base + "/compras/nueva");
  await page.selectOption("select[name=proveedor]", { label: "Juan Pérez · 00100000001" });
  await page.selectOption("select[name=tipo]", "B11");
  await ver("se asigna de tu rango B11");
  await page.fill("input[name=fecha]", "2026-10-05");
  await page.getByLabel("Descripción de la línea 1").fill("Reparación de puerta");
  await page.getByLabel("Precio de la línea 1").fill("5000");
  await page.getByLabel("ITBIS de la línea 1").selectOption({ label: "Exento" });
  await boton("Registrar compra");
  await ver("No hay comprobantes B11 disponibles");
  await boton("Guardar borrador");
  await page.waitForURL(/\?guardada=1/);
  await ir(base + "/comprobantes");
  await page.selectOption("select[name=tipo]", "B11");
  await page.fill("input[name=hasta]", "50");
  await boton("Agregar rango");
  await ver("Rango B11 agregado.");
  await ir(base + "/compras?estado=borradores&mes=");
  await page.click("text=Borrador B11");
  await page.waitForURL(/compras\/[0-9a-f-]+$/);
  await page.waitForLoadState("networkidle");
  await boton("Registrar compra");
  await ver("Compra registrada con NCF B1100000001");
  paso("comprobante de compras B11: sin rango no se registra; con rango toma B1100000001");

  // 7. Nota de crédito del proveedor
  await ir(urlCompra);
  await page.click("text=Registrar nota de crédito del proveedor");
  await page.waitForURL(/compras\/nueva\?origen=/);
  await page.waitForLoadState("networkidle");
  await page.fill("input[name=ncf]", "B0400000001");
  await page.fill("input[name=fecha]", "2026-10-10");
  await page.getByLabel("Descripción de la línea 1").fill("Descuento por pronto pago");
  await page.getByLabel("Precio de la línea 1").fill("1000");
  await boton("Registrar nota de crédito");
  await page.waitForURL(/\?registrada=1/);
  await ver("Nota de crédito registrada con NCF B0400000001");
  await ir(urlCompra);
  const saldo = await page.locator("tr", { hasText: "Saldo pendiente" }).innerText();
  assert(saldo.includes("10,620.00"), "saldo tras la nota: " + saldo);
  paso("nota de crédito del proveedor B0400000001 por 1,180; saldo 10,620");

  // 8. Pago con la retención habitual
  await page.click("text=Registrar pago");
  await page.waitForURL(/pagos\/nuevo\?compra=/);
  await page.waitForLoadState("networkidle");
  assert((await page.getByLabel("Monto a aplicar a B0100000123").inputValue()) === "10620.00", "monto prellenado");
  assert(await page.getByLabel("Aplica ITBIS retenido 30 %").isChecked(), "retención habitual marcada");
  const fila30 = await page.locator("tr", { hasText: "ITBIS retenido 30 %" }).innerText();
  assert(fila30.includes("1,620.00") && fila30.includes("486.00"), "30 % del ITBIS de lo aplicado: " + fila30);
  await page.fill("input[name=fecha]", "2026-10-25");
  assert((await page.locator("input[name=pagado]").inputValue()) === "10134.00", "pagado");
  await page.fill("input[name=referencia]", "TR-77");
  await captura("c-pago.png");
  await boton("Registrar pago");
  await page.waitForURL(/pagos\/1\?nuevo=1/);
  await ver("Menos ITBIS retenido 30 %");
  const a3 = await asiento();
  assert(a3.includes("210101") && a3.includes("10,620.00") && a3.includes("210202") && a3.includes("486.00") && a3.includes("110103") && a3.includes("10,134.00"), "asiento del pago: " + a3);
  paso("pago 1: 10,620 = 10,134 del banco + 486 de ITBIS retenido por pagar a la DGII");

  // 9. Cuentas por pagar
  await ir(base + "/cxp?corte=2026-12-31&detalle=1");
  const tot = await page.locator("tfoot").innerText();
  assert(tot.includes("6,180.00"), "antigüedad por pagar: " + tot);
  await captura("c-antiguedad.png");
  await ir(base + "/proveedores");
  await page.click("tr:has-text('Abogados') >> text=Estado de cuenta");
  await page.waitForURL(/cxp\/estado\?proveedor=/);
  await ir(page.url() + "&hasta=2026-12-31");
  const ecQuery = new URL(page.url()).searchParams.toString();
  const ec = await page.locator(".documento").innerText();
  assert(ec.includes("B0100000123") && ec.includes("B0400000001") && ec.includes("Pago 1"), "estado de cuenta: " + ec);
  for (const r of ["antiguedad-cxp?corte=2026-12-31", "antiguedad-cxp?corte=2026-12-31&formato=pdf", "estado-cuenta-proveedor?" + ecQuery]) {
    const resp = await page.request.get(base + "/exportar/" + r);
    assert(resp.status() === 200, "exportar " + r + " " + resp.status());
  }
  await ir(base + "/balanza?desde=2026-01-01&hasta=2026-12-31");
  assert((await page.locator(".aviso").count()) === 0, "la balanza no cuadra");
  paso("por pagar 6,180 (colmado 1,180 + Juan 5,000); estado de cuenta, descargas y balanza cuadrada");

  // 10. Anular el pago y la compra queda pendiente otra vez
  await ir(base + "/pagos/1");
  await page.fill("input[name=motivo]", "Transferencia devuelta");
  await boton("Anular pago");
  await ver("Pago anulado. Las compras vuelven a quedar pendientes.");
  await ir(urlCompra);
  assert((await page.locator("tr", { hasText: "Saldo pendiente" }).innerText()).includes("10,620.00"), "saldo de nuevo");
  paso("pago anulado: la compra vuelve a deber 10,620");

  // 10b. Excel de las listas (mismo filtro que la pantalla)
  {
    const fx = await excelDe(base + "/compras?mes=&estado=todas");
    assert(fx.filas.at(-1)[0] === "Totales", "fila de totales en compras");
    assert(fx.filas.some((r) => r.includes("ITBIS")), "columna ITBIS en compras");
    const px = await excelDe(base + "/pagos");
    assert(px.filas.some((r) => r[0] === "Pago") && px.filas.some((r) => r.includes("Anulado")), "pagos con el anulado en el Excel");
  }
  paso("Excel de compras y pagos");

  // 11. Inicio y celular
  await ir(base);
  await ver("Por pagar");
  const movil = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await movil.context().addCookies(await page.context().cookies());
  for (const r of ["/compras/nueva", "/pagos/nuevo", "/cxp", "/proveedores", "/compras", "/pagos"]) {
    await movil.goto(base + r, { waitUntil: "networkidle" });
    const w = await movil.evaluate(() => document.documentElement.scrollWidth);
    assert(w <= 392, `desborde en celular ${r}: ${w}`);
  }
  paso("inicio con «Por pagar»; sin desborde en celular");

  await browser.close();
  if (errores.length) { console.log("Errores en el navegador:", errores); process.exit(1); }
  console.log("Sin errores en el navegador");
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
