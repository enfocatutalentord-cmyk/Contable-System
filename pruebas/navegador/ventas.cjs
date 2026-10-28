// Recorrido en el navegador de ventas y CxC (fase 3). Crea su propia firma, así que no necesita base vacía.
// Uso: npm run build && npx next start -p 3100, luego: node pruebas/navegador/ventas.cjs
// PLAYWRIGHT=ruta/a/playwright si no está instalado en el proyecto; BASE=url de la app; CAPTURAS=carpeta de capturas.
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const path = require("node:path");
const fs = require("node:fs");
const S = process.env.CAPTURAS || "/tmp", B = process.env.BASE || "http://localhost:3100";
const assert = (c, m) => { if (!c) throw new Error(m); };
fs.mkdirSync(S, { recursive: true });
fs.writeFileSync(path.join(S, "orden.pdf"), "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

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
  const captura = (n) => page.screenshot({ path: path.join(S, n), fullPage: true });

  // 1. Firma y cliente (empresa)
  await ir(B + "/registro");
  await page.fill("input[name=nombre]", "Joannie");
  await page.fill("input[name=email]", `ventas-${Date.now()}@firma.do`);
  await page.fill("input[name=clave]", "clave-segura-123");
  await page.fill("input[name=firma]", "Firma Ventas SRL");
  await page.click("button.primario");
  await page.waitForURL(/\/firma\/[0-9a-f-]+$/);
  await page.click("text=+ Nuevo cliente");
  await page.fill("input[name=nombre]", "Enfoca Prueba SRL");
  await page.fill("input[name=rnc]", "101000009");
  await page.click("text=Crear cliente");
  await page.waitForURL(/\/e\/[0-9a-f-]+$/);
  const base = page.url();
  paso("firma y empresa creadas");

  // 2. Clientes con datos fiscales y retenciones habituales
  await ir(base + "/clientes");
  await page.fill("input[name=nombre]", "Banco Caribe SA");
  await page.selectOption("select[name=tipo_identificacion]", "rnc");
  await page.fill("input[name=rnc]", "101-00000-1");
  await page.fill("input[name=dias_credito]", "30");
  await page.locator("label", { hasText: "ITBIS retenido 30 %" }).locator("input").check();
  await page.locator("label", { hasText: "ISR honorarios a personas físicas 15 %" }).locator("input").check();
  await boton("Guardar cliente");
  await ver("Cliente Banco Caribe SA guardado.");
  await page.fill("input[name=nombre]", "Pedro Consumidor");
  await page.fill("input[name=rnc]", "");
  await page.fill("input[name=dias_credito]", "0");
  await page.locator("label", { hasText: "ITBIS retenido 30 %" }).locator("input").uncheck();
  await page.locator("label", { hasText: "ISR honorarios a personas físicas 15 %" }).locator("input").uncheck();
  await boton("Guardar cliente");
  await ver("Cliente Pedro Consumidor guardado.");
  await ir(base + "/clientes");
  assert((await page.locator("tr", { hasText: "Banco Caribe" }).innerText()).includes("ITBIS retenido 30 %"), "retenciones habituales");
  paso("clientes con RNC, comprobante y retenciones habituales");

  // 3. Producto con impuesto de la configuración
  await ir(base + "/servicios");
  await page.fill("input[name=nombre]", "Reclutamiento gerencial");
  await page.fill("input[name=precio]", "50000");
  await page.selectOption("select[name=impuesto]", { label: "ITBIS 18 %" });
  await boton("Guardar");
  await ver("Reclutamiento gerencial guardado.");
  paso("producto con ITBIS 18 % de la configuración");

  // 4. Borrador sin NCF, editado
  await ir(base + "/facturas/nueva");
  await ver("No tienes comprobantes B01 disponibles");
  await page.selectOption("select[name=cliente]", { label: "Banco Caribe SA · 101000001" });
  await page.fill("input[name=fecha]", "2026-10-01");
  await page.getByLabel("Producto de la línea 1").selectOption({ label: "Reclutamiento gerencial" });
  await boton("Guardar borrador");
  await page.waitForURL(/facturas\/[0-9a-f-]+\?guardada=1/);
  await ver("Borrador guardado");
  await ver("Sin NCF: se asigna al emitir");
  const urlFactura = page.url().split("?")[0];
  await page.click("text=Editar");
  await page.waitForURL(/editar$/);
  await page.waitForLoadState("networkidle");
  await page.click("text=+ Agregar línea");
  await page.getByLabel("Descripción de la línea 2").fill("Pruebas psicométricas");
  await page.getByLabel("Cantidad de la línea 2").fill("2");
  await page.getByLabel("Precio de la línea 2").fill("1,500");
  await page.getByLabel("ITBIS de la línea 2").selectOption({ label: "Exento" });
  assert((await page.locator("tfoot tr").last().innerText()).includes("62,000.00"), "total en vista previa");
  await captura("v-factura-borrador.png");
  await boton("Guardar borrador");
  await page.waitForURL(/\?guardada=1/);
  assert((await page.locator(".documento tfoot").innerText()).includes("62,000.00"), "total del borrador");
  paso("borrador sin NCF ni asiento, editado: 53,000 + ITBIS 9,000 = 62,000");

  // 5. Emitir: sin rango falla; con rangos toma el NCF
  await boton("Emitir factura");
  await ver("No hay comprobantes B01 disponibles");
  await ir(base + "/comprobantes");
  for (const [tipo, hasta] of [["B01", "50"], ["B02", "50"], ["B04", "20"]]) {
    await page.selectOption("select[name=tipo]", tipo);
    await page.fill("input[name=desde]", "1");
    await page.fill("input[name=hasta]", hasta);
    await boton("Agregar rango");
    await ver(`Rango ${tipo} agregado.`);
  }
  await ir(urlFactura);
  await boton("Emitir factura");
  await page.waitForURL(/\?emitida=1/);
  await ver("Factura emitida con NCF B0100000001");
  assert((await page.locator("text=Editar").count()) === 0, "lo emitido no se edita");
  await captura("v-factura-emitida.png");
  await page.click("text=Ver asiento");
  await page.waitForURL(/asientos\/[0-9a-f-]+$/);
  const asiento = await page.locator("tbody").first().innerText();
  assert(asiento.includes("110201") && asiento.includes("62,000.00") && asiento.includes("410101") && asiento.includes("53,000.00")
    && asiento.includes("210201") && asiento.includes("9,000.00"), "asiento de la factura: " + asiento);
  paso("emitida B0100000001: asiento CxC 62,000 / ingresos 53,000 / ITBIS por pagar 9,000");

  // 6. Nota de crédito y anulación bloqueada
  await ir(urlFactura);
  await page.fill("input[name=fecha]", "2026-10-05");
  await page.fill("input[name=subtotal]", "5000");
  await page.fill("input[name=motivo]", "Descuento acordado");
  await boton("Emitir nota de crédito");
  await ver("Nota de crédito emitida con NCF B0400000001");
  await ir(urlFactura);
  const saldoTexto = await page.locator("tr", { hasText: "Saldo pendiente" }).innerText();
  assert(saldoTexto.includes("56,100.00"), "saldo tras la nota: " + saldoTexto);
  await boton("Anular comprobante");
  await ver("tiene cobros o notas de crédito vigentes");
  paso("nota de crédito B0400000001 por 5,900; saldo 56,100; no deja anular la factura");

  // 7. Cobro con las retenciones habituales del cliente
  await page.click("text=Registrar cobro");
  await page.waitForURL(/cobros\/nuevo\?factura=/);
  await page.waitForLoadState("networkidle");
  assert((await page.getByLabel("Monto a aplicar a B0100000001").inputValue()) === "56100.00", "monto prellenado");
  assert(await page.getByLabel("Aplica ITBIS retenido 30 %").isChecked(), "retención habitual marcada");
  // Sugerido: 30 % del ITBIS proporcional a lo aplicado (56,100 × 9,000 / 62,000 = 8,143.55) = 2,443.06
  const fila30 = await page.locator("tr", { hasText: "ITBIS retenido 30 %" }).innerText();
  assert(fila30.includes("2,443.06"), "sugerido ITBIS: " + fila30);
  await page.fill("input[name=fecha]", "2026-10-20");
  await page.getByLabel("Monto de ITBIS retenido 30 %").fill("2000");
  await page.getByLabel("Monto de ISR honorarios a personas físicas 15 %").fill("1000");
  assert((await page.locator("input[name=recibido]").inputValue()) === "53100.00", "recibido");
  await page.fill("input[name=referencia]", "TRF-998");
  await captura("v-cobro.png");
  await boton("Registrar cobro");
  await page.waitForURL(/cobros\/1\?nuevo=1/);
  await ver("Menos ITBIS retenido 30 %");
  await page.click("text=Ver asiento");
  await page.waitForURL(/asientos\/[0-9a-f-]+$/);
  const a1 = await page.locator("tbody").first().innerText();
  assert(a1.includes("110404") && a1.includes("2,000.00") && a1.includes("110403") && a1.includes("1,000.00") && a1.includes("53,100.00"), "asiento del cobro: " + a1);
  paso("recibo 1: 56,100 = 53,100 recibido + ITBIS retenido 2,000 + ISR retenido 1,000, cada uno a su cuenta");

  // 8. Consumidor final emitida directo; B01 sin RNC bloqueado
  await ir(base + "/facturas/nueva");
  await page.selectOption("select[name=cliente]", { label: "Pedro Consumidor" });
  assert((await page.locator("select[name=tipo]").inputValue()) === "B02", "sugiere B02 sin RNC");
  await page.fill("input[name=fecha]", "2026-08-15");
  await page.fill("input[name=vence]", "2026-08-30");
  await page.getByLabel("Descripción de la línea 1").fill("Asesoría de CV");
  await page.getByLabel("Precio de la línea 1").fill("3000");
  await boton("Emitir factura");
  await ver("Factura emitida con NCF B0200000001");
  await ir(base + "/facturas/nueva");
  await page.selectOption("select[name=cliente]", { label: "Pedro Consumidor" });
  await page.selectOption("select[name=tipo]", "B01");
  await ver("Este cliente no tiene RNC ni cédula");
  paso("B02 a consumidor final emitida al guardar; B01 sin RNC bloqueado");

  // 9. Dólares y diferencia cambiaria (sin retenciones)
  await page.selectOption("select[name=cliente]", { label: "Banco Caribe SA · 101000001" });
  await page.fill("input[name=fecha]", "2026-10-10");
  await page.selectOption("select[name=moneda]", "USD");
  await page.fill("input[name=tasa]", "60");
  await page.getByLabel("Descripción de la línea 1").fill("Consultoría internacional");
  await page.getByLabel("Precio de la línea 1").fill("100");
  await page.getByLabel("ITBIS de la línea 1").selectOption({ label: "Exento" });
  await boton("Emitir factura");
  await ver("Factura emitida con NCF B0100000002");
  await ir(base + "/cobros/nuevo");
  await page.selectOption("select[name=cliente]", { label: "Banco Caribe SA" });
  await page.getByLabel("Cobrar B0100000002").check();
  await page.getByLabel("Aplica ITBIS retenido 30 %").uncheck();
  await page.getByLabel("Aplica ISR honorarios a personas físicas 15 %").uncheck();
  await page.fill("input[name=tasa]", "62");
  await boton("Registrar cobro");
  await page.waitForURL(/cobros\/2\?nuevo=1/);
  await page.click("text=Ver asiento");
  await page.waitForURL(/asientos\/[0-9a-f-]+$/);
  const a2 = await page.locator("tbody").first().innerText();
  assert(a2.includes("6,200.00") && a2.includes("6,000.00") && a2.includes("420102") && a2.includes("200.00"), "asiento cambiario: " + a2);
  await ir(base + "/cobros/2");
  await page.fill("input[name=motivo]", "Cheque devuelto");
  await boton("Anular recibo");
  await ver("Recibo anulado. Las facturas vuelven a quedar pendientes.");
  paso("USD 100 a tasa 60 cobrado a 62: ganancia cambiaria 200; recibo anulado");

  // 10. Antigüedad, estado de cuenta, balanza y descargas
  await ir(base + "/cxc?corte=2026-10-21&detalle=1");
  const tot = await page.locator("tfoot").innerText();
  assert(tot.includes("3,540.00") && tot.includes("6,000.00") && tot.includes("9,540.00"), "antigüedad: " + tot);
  await captura("v-antiguedad.png");
  await ir(base + "/clientes");
  await page.click("tr:has-text('Banco Caribe') >> text=Estado de cuenta");
  await page.waitForURL(/cxc\/estado\?cliente=/);
  const ecQuery = new URL(page.url()).searchParams.toString();
  const ec = await page.locator(".documento").innerText();
  assert(ec.includes("B0100000001") && ec.includes("B0400000001") && ec.includes("Recibo 1"), "estado de cuenta: " + ec);
  await ir(base + "/balanza?desde=2026-01-01&hasta=2026-12-31");
  assert((await page.locator(".aviso").count()) === 0, "la balanza no cuadra");
  for (const r of ["antiguedad?corte=2026-10-21", "estado-cuenta?" + ecQuery, "antiguedad?corte=2026-10-21&formato=pdf"]) {
    const resp = await page.request.get(base + "/exportar/" + r);
    assert(resp.status() === 200, "exportar " + r + " " + resp.status());
  }
  paso("antigüedad 9,540 (6,000 por vencer y 3,540 en 31-60 días), estado de cuenta, balanza cuadrada y descargas");

  // 11. Anular la B02, adjuntar soporte e historial
  await ir(base + "/facturas?mes=&estado=vencidas");
  await page.click("text=B0200000001");
  await page.waitForURL(/facturas\/[0-9a-f-]+$/);
  await page.waitForLoadState("networkidle");
  await page.selectOption("select[name=motivo]", "04");
  await boton("Anular comprobante");
  await ver("Comprobante anulado. Va en el formato 608 del mes.");
  await ir(urlFactura);
  await page.setInputFiles("input[name=archivo]", path.join(S, "orden.pdf"));
  await page.fill("input[name=descripcion]", "Orden de compra del cliente");
  await boton("Adjuntar");
  await ver("Documento adjuntado.");
  await ver("Orden de compra del cliente");
  await ver("Historial de cambios");
  paso("B02 anulada con motivo 608; orden de compra adjunta a la factura; historial visible");

  // 12. Aprobación obligatoria: quien registra guarda el borrador y otra persona emite
  await ir(base + "/empresa");
  await page.check("input[name=requiere_aprobacion]");
  await boton("Guardar cambios");
  await ver("Ficha actualizada.");
  await ir(base + "/facturas/nueva");
  assert((await page.getByRole("button", { name: "Emitir factura" }).count()) === 0, "sin botón de emitir");
  await page.selectOption("select[name=cliente]", { label: "Banco Caribe SA · 101000001" });
  await page.getByLabel("Descripción de la línea 1").fill("Taller de liderazgo");
  await page.getByLabel("Precio de la línea 1").fill("20000");
  await boton("Guardar borrador");
  await ver("Este borrador lo registraste tú");
  await ir(base + "/facturas?estado=borradores&mes=");
  await ver("Borrador B01");
  await captura("v-borradores.png");
  await ir(base + "/empresa");
  await page.uncheck("input[name=requiere_aprobacion]");
  await boton("Guardar cambios");
  paso("con aprobación obligatoria, quien registra solo guarda borradores");

  // 13. Celular
  const movil = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await movil.context().addCookies(await page.context().cookies());
  for (const r of ["/facturas/nueva", "/cobros/nuevo", "/cxc", "/clientes", "/servicios", "/facturas"]) {
    await movil.goto(base + r, { waitUntil: "networkidle" });
    const w = await movil.evaluate(() => document.documentElement.scrollWidth);
    assert(w <= 392, `desborde en celular ${r}: ${w}`);
  }
  paso("sin desborde en celular");

  await browser.close();
  if (errores.length) { console.log("Errores en el navegador:", errores); process.exit(1); }
  console.log("Sin errores en el navegador");
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
