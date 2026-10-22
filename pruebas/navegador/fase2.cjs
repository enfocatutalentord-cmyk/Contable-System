// Recorrido en el navegador. Requiere la app corriendo con una base vacía.
// Uso: npm run build && npx next start -p 3100, luego: node pruebas/navegador/fase2.cjs
// PLAYWRIGHT=ruta/a/playwright si no está instalado en el proyecto; BASE=url de la app.
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const S = process.env.CAPTURAS || "/tmp", B = process.env.BASE || "http://localhost:3100";
const assert = (c, m) => { if (!c) throw new Error(m); };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => m.type() === "error" && errores.push(m.text()));
  const paso = (t) => console.log("✓", t);
  const exito = async (texto) => page.waitForSelector(`text=${texto}`, { timeout: 15000 });

  await page.goto(B + "/registro");
  await page.fill('input[name=nombre]', "Joannie");
  await page.fill('input[name=email]', "jo@prueba.do");
  await page.fill('input[name=clave]', "clave-segura-123");
  await page.fill('input[name=empresa]', "Enfoca Prueba SRL");
  await page.fill('input[name=rnc]', "132151119");
  await page.click("button.primario");
  await page.waitForURL(B + "/empresas");
  await page.click("text=Enfoca Prueba SRL");
  await page.waitForURL(/\/e\/[0-9a-f-]+$/);
  const base = page.url();

  // Clientes
  await page.goto(base + "/clientes");
  await page.fill('input[name=nombre]', "Banco Caribe SA");
  await page.fill('input[name=rnc]', "101-00000-1");
  await page.fill('input[name=dias_credito]', "30");
  await page.click("text=Guardar cliente");
  await exito("Cliente Banco Caribe SA guardado.");
  await page.fill('input[name=nombre]', "Pedro Consumidor");
  await page.fill('input[name=rnc]', "");
  await page.fill('input[name=dias_credito]', "0");
  await page.click("text=Guardar cliente");
  await exito("Cliente Pedro Consumidor guardado.");
  paso("dos clientes (con y sin RNC)");

  // Servicio
  await page.goto(base + "/servicios");
  await page.fill('input[name=nombre]', "Reclutamiento gerencial");
  await page.fill('input[name=precio]', "50000");
  await page.click("text=Guardar servicio");
  await exito("Servicio Reclutamiento gerencial guardado.");
  paso("servicio creado");

  // Sin NCF no deja facturar
  await page.goto(base + "/facturas/nueva");
  await page.waitForSelector("text=No tienes comprobantes B01 disponibles");
  paso("aviso de NCF faltantes");

  // Rangos NCF
  await page.goto(base + "/comprobantes");
  for (const [tipo, hasta] of [["B01", "50"], ["B02", "50"], ["B04", "20"]]) {
    await page.selectOption("select[name=tipo]", tipo);
    await page.fill("input[name=desde]", "1");
    await page.fill("input[name=hasta]", hasta);
    await page.getByRole("button", { name: "Agregar rango" }).click();
    await exito(`Rango ${tipo} agregado.`);
  }
  await page.selectOption("select[name=tipo]", "B01");
  await page.fill("input[name=desde]", "40");
  await page.fill("input[name=hasta]", "60");
  await page.getByRole("button", { name: "Agregar rango" }).click();
  await exito("Ese rango se cruza con otro");
  paso("rangos B01/B02/B04 y rechazo de rango cruzado");

  // Factura B01
  await page.goto(base + "/facturas/nueva");
  await page.selectOption("select[name=cliente]", { label: "Banco Caribe SA · 101000001" });
  await page.fill("input[name=fecha]", "2026-10-01");
  await page.selectOption('select[name=cliente]', { label: "Banco Caribe SA · 101000001" });
  await page.getByLabel("Servicio de la línea 1").selectOption({ label: "Reclutamiento gerencial" });
  await page.click("text=+ Agregar línea");
  await page.getByLabel("Descripción de la línea 2").fill("Pruebas psicométricas");
  await page.getByLabel("Cantidad de la línea 2").fill("2");
  await page.getByLabel("Precio de la línea 2").fill("1,500");
  await page.getByLabel("ITBIS de la línea 2").selectOption("0");
  const totalVista = await page.locator("tfoot tr").last().innerText();
  assert(totalVista.includes("62,000.00"), "Total en vista previa: " + totalVista);
  await page.screenshot({ path: S + "/f1-nueva-factura.png", fullPage: true });
  await page.click("text=Emitir factura");
  await page.waitForURL(/facturas\/[0-9a-f-]+\?nueva=1/);
  await exito("Factura emitida con NCF B0100000001");
  const urlFactura = page.url().split("?")[0];
  assert((await page.locator(".documento tfoot").innerText()).includes("62,000.00"), "Total factura");
  await page.screenshot({ path: S + "/f2-factura.png", fullPage: true });
  paso("factura B0100000001 por 62,000.00 (53,000 + ITBIS 9,000)");

  // Asiento de la factura
  await page.click("text=Ver asiento n.º 1"); await page.waitForURL(/asientos\/1$/);
  const asiento = await page.locator("tbody").innerText();
  assert(asiento.includes("110201") && asiento.includes("62,000.00") && asiento.includes("410101") && asiento.includes("53,000.00") && asiento.includes("210201") && asiento.includes("9,000.00"), "Asiento factura: " + asiento);
  assert((await page.locator("text=Anular asiento").count()) === 0, "No debe dejar anular un asiento de documento");
  paso("asiento automático correcto y no se anula desde Asientos");

  // Nota de crédito
  await page.goto(urlFactura);
  await page.fill("input[name=fecha]", "2026-10-05");
  await page.fill("input[name=subtotal]", "5000");
  await page.fill("input[name=motivo]", "Descuento acordado");
  await page.click("text=Emitir nota de crédito");
  await exito("Nota de crédito emitida con NCF B0400000001");
  paso("nota de crédito B0400000001 por 5,900.00");
  await page.goto(urlFactura);
  assert((await page.locator("text=Saldo pendiente").locator("..").innerText()).includes("56,100.00"), "Saldo tras NC");
  paso("saldo de la factura 56,100.00");

  // No se puede anular factura con NC vigente
  await page.click("text=Anular comprobante >> nth=-1");
  await exito("tiene cobros o notas de crédito vigentes");
  paso("no deja anular una factura con nota de crédito");

  // Cobro con retenciones
  await page.click("text=Registrar cobro");
  await page.waitForURL(/cobros\/nuevo\?factura=/);
  assert((await page.getByLabel("Monto a aplicar a B0100000001").inputValue()) === "56100.00", "Prellenado del monto");
  await page.fill("input[name=retencion_itbis]", "2000");
  await page.fill("input[name=retencion_isr]", "1000");
  await page.fill("input[name=fecha]", "2026-10-20");
  assert((await page.locator("input[name=recibido]").inputValue()) === "53100.00", "Recibido");
  await page.fill("input[name=referencia]", "TRF-998");
  await page.screenshot({ path: S + "/f3-cobro.png", fullPage: true });
  await page.getByRole("button", { name: "Registrar cobro" }).click();
  await page.waitForURL(/cobros\/1\?nuevo=1/);
  await page.screenshot({ path: S + "/f4-recibo.png", fullPage: true });
  paso("recibo 1: aplicado 56,100 = recibido 53,100 + ITBIS 2,000 + ISR 1,000");
  await page.goto(urlFactura);
  await page.waitForSelector("text=Sin cobros todavía", { state: "detached" });
  assert((await page.locator("text=Saldo pendiente").locator("..").innerText()).includes("0.00"), "Saldo cero");
  paso("factura queda pagada");

  // Factura B02 vieja a consumidor (vencida)
  await page.goto(base + "/facturas/nueva");
  await page.selectOption("select[name=cliente]", { label: "Pedro Consumidor" });
  assert((await page.locator("select[name=tipo]").inputValue()) === "B02", "Debe sugerir B02 sin RNC");
  await page.fill("input[name=fecha]", "2026-08-15");
  await page.fill("input[name=vence]", "2026-08-30");
  await page.getByLabel("Descripción de la línea 1").fill("Asesoría de CV");
  await page.getByLabel("Precio de la línea 1").fill("3000");
  await page.click("text=Emitir factura");
  await exito("Factura emitida con NCF B0200000001");
  paso("factura B02 a consumidor final");

  // B01 a cliente sin RNC: bloqueado
  await page.goto(base + "/facturas/nueva");
  await page.selectOption("select[name=cliente]", { label: "Pedro Consumidor" });
  await page.selectOption("select[name=tipo]", "B01");
  await page.waitForSelector("text=Este cliente no tiene RNC");
  paso("B01 sin RNC queda bloqueado");

  // Factura en dólares y cobro a otra tasa
  await page.goto(base + "/facturas/nueva");
  await page.selectOption("select[name=cliente]", { label: "Banco Caribe SA · 101000001" });
  await page.fill("input[name=fecha]", "2026-10-10");
  await page.selectOption("select[name=moneda]", "USD");
  await page.fill("input[name=tasa]", "60");
  await page.getByLabel("Descripción de la línea 1").fill("Consultoría internacional");
  await page.getByLabel("Precio de la línea 1").fill("100");
  await page.getByLabel("ITBIS de la línea 1").selectOption("0");
  await page.click("text=Emitir factura");
  await exito("Factura emitida con NCF B0100000002");
  paso("factura USD 100 a tasa 60");
  await page.goto(base + "/cobros/nuevo");
  await page.selectOption("select[name=cliente]", { label: "Banco Caribe SA" });
  await page.getByLabel("Cobrar B0100000002").check();
  await page.fill("input[name=tasa]", "62");
  await page.getByRole("button", { name: "Registrar cobro" }).click();
  await page.waitForURL(/cobros\/2\?nuevo=1/);
  await page.click("text=Ver asiento"); await page.waitForURL(/asientos\/\d+$/);
  const a2 = await page.locator("tbody").innerText();
  assert(a2.includes("6,200.00") && a2.includes("6,000.00") && a2.includes("420102") && a2.includes("200.00"), "Asiento cambiario: " + a2);
  paso("cobro USD a tasa 62: ganancia cambiaria 200.00");

  // Anular el cobro USD: la factura vuelve a pendiente
  await page.goto(base + "/cobros/2");
  await page.fill("input[name=motivo]", "Cheque devuelto");
  await page.click("text=Anular recibo >> nth=-1");
  await exito("Recibo anulado. Las facturas vuelven a quedar pendientes.");
  paso("recibo 2 anulado");

  // Antigüedad
  await page.goto(base + "/cxc?corte=2026-10-21&detalle=1");
  const tot = await page.locator("tfoot").innerText();
  assert(tot.includes("3,540.00") && tot.includes("6,000.00") && tot.includes("9,540.00"), "Antigüedad: " + tot);
  await page.screenshot({ path: S + "/f5-antiguedad.png", fullPage: true });
  paso("antigüedad: 6,000 por vencer (USD) y 3,540 en 31-60 días; total 9,540");

  // Estado de cuenta
  await page.goto(base + "/clientes");
  await page.click("tr:has-text('Banco Caribe') >> text=Estado de cuenta");
  await page.waitForURL(/cxc\/estado\?cliente=/);
  const ecQuery = new URL(page.url()).searchParams.toString();
  const ec = await page.locator(".documento").innerText();
  assert(ec.includes("B0100000001") && ec.includes("B0400000001") && ec.includes("Recibo 1"), "Estado de cuenta: " + ec);
  await page.screenshot({ path: S + "/f6-estado.png", fullPage: true });
  paso("estado de cuenta con factura, nota y recibo");

  // Balanza
  await page.goto(base + "/balanza?desde=2026-01-01&hasta=2026-12-31");
  assert((await page.locator(".aviso").count()) === 0, "Balanza no cuadra");
  const bal = await page.locator("tbody").innerText();
  assert(bal.includes("110404") && bal.includes("110403"), "Retenciones en balanza");
  paso("balanza cuadra con retenciones registradas");

  // Exportaciones
  for (const r of ["antiguedad?corte=2026-10-21", "estado-cuenta?" + ecQuery]) {
    const resp = await page.request.get(base + "/exportar/" + r);
    assert(resp.status() === 200, "Exportar " + r + " " + resp.status());
  }
  paso("descargas de antigüedad y estado de cuenta");

  // Anular factura B02 (sin cobros)
  await page.goto(base + "/facturas?mes=&estado=vencidas");
  await page.click("text=B0200000001");
  await page.selectOption("select[name=motivo]", "04");
  await page.click("text=Anular comprobante >> nth=-1");
  await exito("Comprobante anulado. Va en el formato 608 del mes.");
  paso("factura B02 anulada con motivo 608");

  // Inicio con por cobrar
  await page.goto(base);
  console.log("  cifras:", (await page.locator(".cifra").allInnerTexts()).map((t) => t.replace("\n", ": ")).join(" · "));

  // Celular
  const movil = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await movil.context().addCookies(await page.context().cookies());
  for (const r of ["/facturas/nueva", "/cobros/nuevo", "/cxc"]) {
    await movil.goto(base + r);
    const w = await movil.evaluate(() => document.documentElement.scrollWidth);
    assert(w <= 375, `Desborde en celular ${r}: ${w}`);
  }
  paso("sin desborde en celular");

  console.log(errores.length ? "Errores del navegador: " + errores.join(" || ") : "Sin errores en el navegador");
  await browser.close();
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
