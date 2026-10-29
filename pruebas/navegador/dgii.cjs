// Recorrido de Reportes DGII (606, 607 y 608). Crea su propia firma; los movimientos se cargan con la lógica real
// (datos-dgii.mjs). Uso: npm run build && npx next start -p 3100, luego:
// DATABASE_URL=... node --experimental-strip-types pruebas/navegador/dgii.cjs
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const path = require("node:path");
const fs = require("node:fs");
const S = process.env.CAPTURAS || "/tmp", B = process.env.BASE || "http://localhost:3100";
const assert = (c, m) => { if (!c) throw new Error(m); };
fs.mkdirSync(S, { recursive: true });

(async () => {
  const { sembrar } = await import("./datos-dgii.mjs");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => m.type() === "error" && errores.push(m.text()));
  const paso = (t) => console.log("✓", t);
  const ir = (url) => page.goto(url, { waitUntil: "networkidle" });
  const boton = (nombre, dentro = page) => dentro.getByRole("button", { name: nombre, exact: true }).click();
  const seccion = (f) => page.locator(`#f${f}`);
  const correo = `dgii-${Date.now()}@firma.do`;

  // 1. Firma, cliente y movimientos de octubre 2026
  await ir(B + "/registro");
  await page.fill("input[name=nombre]", "Joannie");
  await page.fill("input[name=email]", correo);
  await page.fill("input[name=clave]", "clave-segura-123");
  await page.fill("input[name=firma]", "Firma DGII SRL");
  await page.click("button.primario");
  await page.waitForURL(/\/firma\/[0-9a-f-]+$/);
  await page.click("text=+ Nuevo cliente");
  await page.fill("input[name=nombre]", "Formatos SRL");
  await page.fill("input[name=rnc]", "101000009");
  await page.click("text=Crear cliente");
  await page.waitForURL(/\/e\/[0-9a-f-]+$/);
  const base = page.url();
  const { ncfFactura } = await sembrar(base.split("/e/")[1], correo);
  paso("firma y cliente creados; compras, pago con retenciones, factura y cobro de octubre");

  // 2. La pestaña está en Impuestos y muestra los tres formatos del mes
  await page.getByRole("link", { name: "Reportes DGII" }).click();
  await page.waitForURL(/\/dgii/);
  await ir(base + "/dgii?mes=2026-10");
  await page.waitForSelector("text=período 202610");
  await page.waitForSelector("text=vence el 15/11/2026");
  assert(await seccion("606").getByText("Ferretería sin RNC").count(), "error del proveedor sin RNC en el 606");
  assert(await seccion("606").getByText("1 por corregir").count(), "el 606 tiene un error por corregir");
  assert(!(await seccion("606").getByRole("button", { name: "Marcar como enviado" }).count()), "con errores no se marca enviado");
  const cifras = await seccion("606").locator(".cifras-dgii").innerText();
  assert(/ITBIS RETENIDO\s*540\.00/i.test(cifras) && /ISR RETENIDO\s*1,500\.00/i.test(cifras), "retenciones del 606: " + cifras);
  assert(await seccion("607").getByText("Listo para enviar").count(), "el 607 está listo");
  assert(await seccion("608").getByText("se envía en cero").count(), "el 608 sin anulaciones se envía en cero");
  await page.screenshot({ path: path.join(S, "dgii-octubre.png"), fullPage: true });
  paso("Reportes DGII de octubre: 606 con un error que lleva a corregir, 607 listo, 608 en cero");

  // 3. Corregir el error desde su enlace: el proveedor no tiene RNC
  await seccion("606").getByRole("link", { name: "Corregir →" }).first().click();
  await page.waitForURL(/\/proveedores$/);
  await page.waitForSelector("text=Ferretería sin RNC");
  paso("el error lleva a Proveedores, donde se corrige el RNC");

  // 4. Excel del 607 con las 23 columnas del instructivo y el nombre que usa la DGII
  await ir(base + "/dgii?mes=2026-10");
  const [d] = await Promise.all([page.waitForEvent("download"), seccion("607").locator(".descargar a", { hasText: "Excel" }).click()]);
  assert(/^DGII_F_607_101000009_202610\.xlsx$/.test(d.suggestedFilename()), "nombre del archivo: " + d.suggestedFilename());
  const ExcelJS = require(path.join(process.cwd(), "node_modules/exceljs"));
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(await d.path());
  const filas = [];
  libro.worksheets[0].eachRow((r) => filas.push(r.values.slice(1)));
  const cab = filas.find((r) => r[0] === "1. RNC / Cédula o Pasaporte");
  assert(cab && cab.length === 23 && cab[22] === "23. Otras Formas de Ventas", "23 columnas del 607: " + cab);
  const f = filas.find((r) => r[2] === ncfFactura);
  assert(f && f[1] === "1" && f[4] === "01" && f[5] === "20261006" && f[7] === 5000 && f[8] === 900 && f[17] === 5900, "fila de la factura: " + f);
  assert(filas.some((r) => String(r[0]).includes("Cantidad de registros 1")), "encabezado con la cantidad de registros");
  paso("Excel del 607: 23 columnas en el orden del instructivo, cobro por transferencia en su columna");

  // 4b. Archivo TXT del 607 como el de la herramienta de la DGII; el 606 con errores no ofrece TXT
  assert(!(await seccion("606").getByRole("link", { name: "Archivo TXT" }).count()), "con errores no hay TXT");
  const [t] = await Promise.all([page.waitForEvent("download"), seccion("607").getByRole("link", { name: "Archivo TXT" }).click()]);
  assert(t.suggestedFilename() === "DGII_F_607_101000009_202610.txt", "nombre del TXT: " + t.suggestedFilename());
  const lineas = fs.readFileSync(await t.path(), "latin1").split("\r\n");
  assert(lineas[0] === "607|101000009|202610|1", "encabezado: " + lineas[0]);
  assert(lineas[1].split("|").length === 23, "23 campos");
  assert(lineas[1] === `101000001|1|${ncfFactura}||1|20261006||5000|900|||||||||5900|||||`, "registro: " + lineas[1]);
  paso("Archivo TXT del 607 con el encabezado y los campos de la herramienta de la DGII");

  // 5. Marcar el 607 como enviado con la referencia de la Oficina Virtual
  await seccion("607").locator("input[name=referencia]").fill("OFV-12345");
  await boton("Marcar como enviado", seccion("607"));
  await seccion("607").getByText("Enviado", { exact: true }).waitFor();
  await seccion("607").getByText("referencia OFV-12345").waitFor();
  await boton("Marcar enviado en cero", seccion("608"));
  await seccion("608").getByText("Enviado en cero").waitFor();
  paso("607 marcado como enviado con su referencia; 608 enviado en cero");

  // 6. Si cambia algo del mes después del envío, se avisa
  await ir(base + "/facturas/nueva");
  await page.selectOption("select[name=cliente]", { label: "Cliente SRL · 101000001" });
  await page.selectOption("select[name=tipo_ingreso]", "04");
  await page.fill("input[name=fecha]", "2026-10-28");
  await page.getByLabel("Descripción de la línea 1").fill("Alquiler de local");
  await page.getByLabel("Precio de la línea 1").fill("20000");
  await boton("Emitir factura");
  await page.waitForURL(/emitida=1/);
  await ir(base + "/dgii?mes=2026-10");
  await seccion("607").getByText("Cambió después del envío").waitFor();
  await seccion("607").getByText("Ver los 2 registros").click();
  await seccion("607").getByText("Ingresos por arrendamientos").waitFor();
  await boton("Quitar marca de enviado", seccion("607"));
  await seccion("607").getByText("Listo para enviar").waitFor();
  paso("una factura emitida después del envío avisa «Cambió después del envío»; el tipo de ingreso elegido sale en el 607");

  // 6b. IT-1 de octubre: borrador con las casillas de lo registrado, lo escrito a mano manda, Excel y presentado
  await seccion("607").getByText("Listo para enviar").waitFor();
  await page.getByRole("link", { name: "Abrir el IT-1 de 202610" }).click();
  await page.waitForURL(/\/dgii\/it1\?mes=2026-10/);
  await page.waitForSelector("text=IT-1 · Declaración del ITBIS");
  const cifrasIt1 = await page.locator(".cifras-dgii").innerText();
  // Ventas gravadas 5,000 + 20,000 → ITBIS 4,500; compras con crédito 1,800 + 360 = 2,160; diferencia 2,340.
  assert(/ITBIS COBRADO \(21\)\s*4,500\.00/i.test(cifrasIt1) && /ITBIS DEDUCIBLE \(25\)\s*2,160\.00/i.test(cifrasIt1)
    && /DIFERENCIA A PAGAR \(33\)\s*2,340\.00/i.test(cifrasIt1), "cifras del IT-1: " + cifrasIt1);
  assert((await page.getByLabel("Casilla I43").inputValue()) === "10000.00", "base de la retención del 30 %");
  await page.getByLabel("Casilla I31").fill("340");
  await boton("Guardar y recalcular");
  await page.waitForSelector("text=Borrador del IT-1 guardado y recalculado.");
  await page.waitForFunction(() => /DIFERENCIA A PAGAR \(33\)\s*2,000\.00/i.test(document.querySelector(".cifras-dgii").innerText));
  await page.waitForSelector("text=Sugerido: 0.00");
  await page.screenshot({ path: path.join(S, "it1.png"), fullPage: true });
  const [x] = await Promise.all([page.waitForEvent("download"), page.locator(".descargar a", { hasText: "Excel" }).click()]);
  assert(x.suggestedFilename() === "IT-1_101000009_202610.xlsx", "Excel del IT-1: " + x.suggestedFilename());
  await page.locator("input[name=referencia]").fill("IT1-777");
  await boton("Marcar como presentado");
  await page.waitForSelector("text=referencia IT1-777");
  await page.locator(".estado-envio", { hasText: "Presentado" }).waitFor();
  assert(!(await page.getByRole("button", { name: "Guardar y recalcular" }).count()), "presentado: ya no se edita");
  paso("IT-1: casillas desde lo registrado (ITBIS 4,500 − 2,160), casilla escrita a mano, Excel y marcado como presentado");

  // 7. Celular
  const movil = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await movil.context().addCookies(await page.context().cookies());
  for (const r of ["/dgii?mes=2026-10", "/dgii/it1?mes=2026-10"]) {
    await movil.goto(base + r, { waitUntil: "networkidle" });
    const w = await movil.evaluate(() => document.documentElement.scrollWidth);
    assert(w <= 392, `desborde en celular ${r}: ${w}`);
  }
  await movil.screenshot({ path: path.join(S, "dgii-celular.png"), fullPage: true });
  paso("sin desborde en celular");

  await browser.close();
  if (errores.length) { console.log("Errores en el navegador:", errores); process.exit(1); }
  console.log("Sin errores en el navegador");
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
