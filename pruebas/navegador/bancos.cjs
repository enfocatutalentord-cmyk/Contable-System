// Recorrido de Bancos (Fase 5, parte 1): cuenta bancaria ligada al catálogo, importación de un CSV con títulos arriba
// (vista previa, lo anterior a la fecha inicial no entra), un Excel que se monta sobre el anterior sin repetir nada,
// deshacer una importación, un estado de cuenta que sube el cliente en «Documentos» y un PDF que se rechaza.
// Crea su propia firma. Uso: npm run build && npx next start -p 3100, luego: node pruebas/navegador/bancos.cjs
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const ExcelJS = require("exceljs");
const path = require("node:path");
const S = process.env.CAPTURAS || "/tmp", B = process.env.BASE || "http://localhost:3100";
const assert = (c, m) => { if (!c) throw new Error(m); };
const abrirMenu = async (p) => {
  const b = p.locator(".menu-boton");
  if (await b.isVisible() && (await b.getAttribute("aria-expanded")) !== "true") await b.click();
};

const CSV = `Banco Popular Dominicano
Estado de cuenta corriente ****1234
Fecha;Descripción;Referencia;Débito;Crédito;Balance
03/10/2026;COMISION MANEJO DE CUENTA;;150.00;;119,810.00
02/10/2026;IMPUESTO DGII 0.20%;;40.00;;119,960.00
02/10/2026;TRANSF. RECIBIDA CLIENTE SRL;55501;;20,000.00;120,000.00
01/10/2026;PAGO PROVEEDOR;9001;5,000.00;;100,000.00
30/09/2026;DEPOSITO;100;;5,000.00;105,000.00
`;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

(async () => {
  const libro = new ExcelJS.Workbook();
  const h = libro.addWorksheet("Movimientos");
  h.addRow(["Fecha", "Concepto", "No. Documento", "Monto", "Balance"]);
  h.addRow([new Date(Date.UTC(2026, 9, 2)), "IMPUESTO DGII 0.20%", null, -40, 119960]);
  h.addRow([new Date(Date.UTC(2026, 9, 3)), "COMISION MANEJO DE CUENTA", null, -150, 119810]);
  h.addRow([new Date(Date.UTC(2026, 9, 5)), "DEPOSITO EFECTIVO", "77", 3500.5, 123310.5]);
  const XLSX = Buffer.from(await libro.xlsx.writeBuffer());

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => m.type() === "error" && errores.push(m.text()));
  const paso = (t) => console.log("✓", t);
  const captura = (p, n) => p.screenshot({ path: path.join(S, n), fullPage: true });
  const sello = Date.now();

  await page.goto(B + "/registro", { waitUntil: "networkidle" });
  await page.fill("input[name=nombre]", "Joannie");
  await page.fill("input[name=email]", `bancos-${sello}@firma.do`);
  await page.fill("input[name=clave]", "clave-segura-123");
  await page.fill("input[name=firma]", "Firma Bancos SRL");
  await page.getByRole("button", { name: /crear/i }).click();
  await page.waitForURL(/\/firma\/[0-9a-f-]+$/);
  const fid = page.url().split("/")[4];
  await page.goto(`${B}/firma/${fid}/clientes/nuevo`, { waitUntil: "networkidle" });
  await page.fill("input[name=nombre]", "Cliente Bancos SRL");
  await page.fill("input[name=rnc]", "101000050");
  await page.getByRole("button", { name: "Crear cliente" }).click();
  await page.waitForURL(/\/e\/[0-9a-f-]+$/);
  const eid = page.url().split("/")[4];

  // 1. La pestaña Bancos en Contabilidad y el alta de la cuenta
  await abrirMenu(page);
  await page.click("nav.menu >> text=Bancos");
  await page.waitForURL(/\/bancos$/);
  await page.locator("text=Todavía no hay cuentas bancarias").waitFor();
  const alta = page.locator("form", { has: page.getByRole("button", { name: "Agregar cuenta" }) });
  await alta.locator("input[name=banco]").fill("Banco Popular");
  await alta.locator("input[name=nombre]").fill("Popular corriente");
  await alta.locator("input[name=numero]").fill("1234");
  await alta.locator("select[name=cuenta_id]").selectOption({ label: "110103 · Banco cuenta corriente" });
  await alta.locator("input[name=fecha_inicial]").fill("2026-10-01");
  await alta.locator("input[name=saldo_inicial]").fill("105,000.00");
  await alta.getByRole("button", { name: "Agregar cuenta" }).click();
  await alta.locator("text=Cuenta bancaria agregada.").waitFor();
  await page.getByRole("link", { name: "Popular corriente" }).click();
  await page.waitForURL(/\/bancos\/[0-9a-f-]+$/);
  const cid = page.url().split("/").pop();
  paso("cuenta bancaria creada y ligada a la 110103");

  // 2. Un PDF no se acepta
  const subir = page.locator("form", { has: page.getByRole("button", { name: "Subir y ver la vista previa" }) });
  await subir.locator("input[name=archivo]").setInputFiles({ name: "estado.pdf", mimeType: "application/pdf", buffer: PDF });
  await subir.getByRole("button", { name: "Subir y ver la vista previa" }).click();
  await subir.locator("text=no es Excel (.xlsx), CSV ni OFX").waitFor();
  paso("un PDF se rechaza con la indicación de pedir Excel o CSV al banco");

  // 3. CSV con títulos arriba: encabezado y columnas adivinados, vista previa e importación
  await subir.locator("input[name=archivo]").setInputFiles({ name: "popular-octubre.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await subir.getByRole("button", { name: "Subir y ver la vista previa" }).click();
  await page.waitForURL(/\/importar\//);
  assert(await page.locator("select[name=encabezado]").inputValue() === "2", "encabezado en la fila 3");
  assert(await page.locator("select[name=debito]").inputValue() === "Débito", "débito");
  assert(await page.locator("select[name=credito]").inputValue() === "Crédito", "crédito");
  const cifras = await page.locator(".cifras-dgii").textContent();
  assert(/Nuevos4/.test(cifras) && /Antes del 01\/10\/20261/.test(cifras), "cifras: " + cifras);
  assert(!(await page.locator(".aviso").count()), "sin avisos de saldo");
  await captura(page, "bancos-1-vista-previa.png");
  await page.getByRole("button", { name: "Importar 4 movimientos" }).click();
  await page.waitForURL(/importados=4/);
  await page.locator("text=Se importaron 4 movimientos").waitFor();
  const valores = await page.locator(".cifra .valor").allInnerTexts();
  assert(valores[0] === "119,810.00" && valores[2] === "4", "saldo y pendientes: " + valores);
  paso("CSV importado: 4 movimientos, el del 30/09 no entra, saldo 119,810.00 igual al del banco");

  // 4. Excel que se monta sobre el anterior: un solo monto con signo; solo entra lo nuevo
  await subir.locator("input[name=archivo]").setInputFiles({ name: "popular-semana.xlsx", buffer: XLSX, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  await subir.getByRole("button", { name: "Subir y ver la vista previa" }).click();
  await page.waitForURL(/\/importar\//);
  assert(await page.locator("select[name=monto]").inputValue() === "Monto", "monto con signo");
  const c2 = await page.locator(".cifras-dgii").textContent();
  assert(/Nuevos1/.test(c2) && /Ya estaban2/.test(c2), "cifras Excel: " + c2);
  await captura(page, "bancos-2-excel-repetidos.png");
  await page.getByRole("button", { name: "Importar 1 movimiento" }).click();
  await page.waitForURL(/importados=1&repetidos=2/);
  await page.locator("text=(2 ya estaban y no se repitieron)").waitFor();
  assert((await page.locator(".cifra .valor").first().innerText()) === "123,310.50", "saldo tras el Excel");
  paso("el Excel encima del CSV solo agrega el depósito nuevo (2 ya estaban)");

  // 5. Deshacer la última importación
  await page.getByRole("button", { name: "Deshacer importación" }).first().click();
  await page.waitForURL(/deshecha=1/);
  await page.locator("text=Importación deshecha").waitFor();
  assert((await page.locator(".cifra .valor").first().innerText()) === "119,810.00", "saldo tras deshacer");
  await captura(page, "bancos-3-cuenta.png");
  paso("deshacer quita solo los movimientos de ese archivo");

  // 6. Estado de cuenta que llega por «Documentos del cliente»
  await page.goto(`${B}/e/${eid}/recepcion`, { waitUntil: "networkidle" });
  const rec = page.locator("form", { has: page.getByRole("button", { name: "Subir" }) });
  await rec.locator("select[name=categoria]").selectOption("estado_bancario");
  await rec.locator("input[name=archivos]").setInputFiles({ name: "popular-semana.xlsx", buffer: XLSX, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  await rec.getByRole("button", { name: "Subir" }).click();
  await rec.locator("text=Documento recibido").waitFor();
  await page.reload();
  await page.getByRole("link", { name: "Importar a Bancos" }).click();
  await page.waitForURL(/bancos\/importar\?recepcion=/);
  await page.getByRole("button", { name: "Ver la vista previa" }).click();
  await page.waitForURL(/\/importar\/[0-9a-f-]+$/);
  await page.getByRole("button", { name: "Importar 1 movimiento" }).click();
  await page.waitForURL(/importados=1/);
  await page.goto(`${B}/e/${eid}/recepcion?estado=procesado`, { waitUntil: "networkidle" });
  await page.locator("text=Importado a Popular corriente: 1 movimientos.").waitFor();
  paso("el estado de cuenta en Excel que sube el cliente se importa y su documento queda Procesado");

  // 7. En el celular
  const movil = await (await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() })).newPage();
  await movil.goto(`${B}/e/${eid}/bancos/${cid}`, { waitUntil: "networkidle" });
  const ancho = await movil.evaluate(() => document.documentElement.scrollWidth);
  assert(ancho <= 390, "sin desplazamiento horizontal en el celular: " + ancho);
  await captura(movil, "bancos-4-movil.png");
  paso("la cuenta se ve bien en el celular");

  assert(errores.length === 0, "errores en la consola: " + errores.join(" | "));
  await browser.close();
  console.log("Recorrido de Bancos completo");
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
