// Recorrido de la conciliación bancaria (Fase 5, parte 2): reglas sugeridas, un depósito que coincide por referencia, un
// depósito que junta dos cobros, comisión e impuesto por regla (desconciliar y volver a registrar), un cheque que se
// registra como pago desde el movimiento y queda conciliado solo, y una línea que se excluye.
// Crea su propia firma. Uso: npm run build && npx next start -p 3100, luego:
// DATABASE_URL=... node --experimental-strip-types pruebas/navegador/conciliacion.cjs
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const path = require("node:path");
const S = process.env.CAPTURAS || "/tmp", B = process.env.BASE || "http://localhost:3100";
const assert = (c, m) => { if (!c) throw new Error(m); };

const CSV = `Fecha;Descripción;Referencia;Débito;Crédito;Balance
01/10/2026;TRANSF. RECIBIDA CLIENTE SRL;55501;;20,000.00;20,000.00
02/10/2026;IMPUESTO DGII 0.20%;;40.00;;19,960.00
05/10/2026;DEPOSITO;;;3,500.00;23,460.00
06/10/2026;COMISION MANEJO DE CUENTA;;150.00;;23,310.00
07/10/2026;CHEQUE 000012;12;5,000.00;;18,310.00
08/10/2026;AJUSTE INFORMATIVO;;10.00;;18,300.00
`;

(async () => {
  const { sembrar } = await import("./datos-conciliacion.mjs");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => m.type() === "error" && errores.push(m.text()));
  const paso = (t) => console.log("✓", t);
  const captura = (n) => page.screenshot({ path: path.join(S, n), fullPage: true });
  const correo = `conc-${Date.now()}@firma.do`;
  const fila = (texto) => page.locator("tr", { hasText: texto });
  const valores = () => page.locator(".cifra .valor").allInnerTexts();

  await page.goto(B + "/registro", { waitUntil: "networkidle" });
  await page.fill("input[name=nombre]", "Joannie");
  await page.fill("input[name=email]", correo);
  await page.fill("input[name=clave]", "clave-segura-123");
  await page.fill("input[name=firma]", "Firma Concilia SRL");
  await page.getByRole("button", { name: /crear/i }).click();
  await page.waitForURL(/\/firma\/[0-9a-f-]+$/);
  const fid = page.url().split("/")[4];
  await page.goto(`${B}/firma/${fid}/clientes/nuevo`, { waitUntil: "networkidle" });
  await page.fill("input[name=nombre]", "Cliente Concilia SRL");
  await page.fill("input[name=rnc]", "101000060");
  await page.getByRole("button", { name: "Crear cliente" }).click();
  await page.waitForURL(/\/e\/[0-9a-f-]+$/);
  const eid = page.url().split("/")[4];
  await sembrar(eid, correo);

  // Cuenta, reglas sugeridas e importación
  await page.goto(`${B}/e/${eid}/bancos`, { waitUntil: "networkidle" });
  const alta = page.locator("form", { has: page.getByRole("button", { name: "Agregar cuenta" }) });
  await alta.locator("input[name=banco]").fill("Banco Popular");
  await alta.locator("input[name=nombre]").fill("Popular corriente");
  await alta.locator("select[name=cuenta_id]").selectOption({ label: "110103 · Banco cuenta corriente" });
  await alta.locator("input[name=fecha_inicial]").fill("2026-10-01");
  await alta.locator("input[name=saldo_inicial]").fill("0");
  await alta.getByRole("button", { name: "Agregar cuenta" }).click();
  await alta.locator("text=Cuenta bancaria agregada.").waitFor();
  await page.goto(`${B}/e/${eid}/bancos/reglas`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Agregar reglas sugeridas" }).click();
  await page.locator("text=Se agregaron 2 reglas.").waitFor();
  paso("reglas sugeridas: comisiones (620101) e impuesto a cheques y transferencias (620104)");
  await page.goto(`${B}/e/${eid}/bancos`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Popular corriente" }).click();
  await page.waitForURL(/\/bancos\/[0-9a-f-]+$/);
  const cuentaUrl = page.url();
  const subir = page.locator("form", { has: page.getByRole("button", { name: "Subir y ver la vista previa" }) });
  await subir.locator("input[name=archivo]").setInputFiles({ name: "popular.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await subir.getByRole("button", { name: "Subir y ver la vista previa" }).click();
  await page.getByRole("button", { name: "Importar 6 movimientos" }).click();
  await page.waitForURL(/importados=6/);

  // Sugerencias
  assert(/Coincide\s*Mismo monto y misma referencia/.test(await fila("TRANSF. RECIBIDA").innerText()), "depósito por referencia");
  assert(/Posible\s*2 registros que suman el monto/.test(await fila("DEPOSITO").innerText()), "depósito combinado");
  assert(/Regla\s*Impuesto a cheques/.test(await fila("IMPUESTO DGII").innerText()), "regla impuesto");
  assert(/Regla\s*Comisiones y cargos/.test(await fila("COMISION MANEJO").innerText()), "regla comisión");
  assert(/Sin sugerencia/.test(await fila("CHEQUE 000012").innerText()), "cheque sin sugerencia");
  await captura("conciliacion-1-sugerencias.png");
  paso("sugerencias: referencia, combinación de dos cobros, reglas y «sin sugerencia»");

  const confirmar = async (texto, boton) => {
    await fila(texto).getByRole("button", { name: boton }).click();
    await fila(texto).waitFor({ state: "detached" }); // sale de «Por conciliar»
  };
  await confirmar("TRANSF. RECIBIDA", "Confirmar");
  await confirmar("DEPOSITO", "Confirmar");
  await confirmar("IMPUESTO DGII", "Registrar y conciliar");
  await confirmar("COMISION MANEJO", "Registrar y conciliar");
  assert((await valores())[2] === "2", "quedan el cheque y el ajuste: " + await valores());
  paso("confirmados los dos depósitos y registrados por regla el impuesto y la comisión");

  // Desconciliar la comisión: su asiento se anula y el movimiento vuelve a estar por conciliar
  await page.goto(cuentaUrl + "?estado=conciliado", { waitUntil: "networkidle" });
  await fila("COMISION MANEJO").getByRole("button", { name: "Desconciliar" }).click();
  await page.waitForURL(/aviso=desconciliado/);
  await page.locator("text=Movimiento desconciliado").waitFor();
  assert((await valores())[1] === "23,460.00", "libros sin la comisión: " + await valores());
  await confirmar("COMISION MANEJO", "Registrar y conciliar");
  paso("desconciliar anula el asiento hecho desde el banco; se vuelve a registrar");

  // Cheque: registrar el pago desde el movimiento
  await fila("CHEQUE 000012").getByRole("link", { name: "Buscar o registrar" }).click();
  await page.waitForURL(/\/m\//);
  await page.getByRole("link", { name: "Registrar pago" }).click();
  await page.waitForURL(/pagos\/nuevo\?movimiento=/);
  await page.locator("text=Desde el banco: movimiento del 07/10/2026").waitFor();
  assert((await page.locator("input[name=fecha]").inputValue()) === "2026-10-07", "fecha prellenada");
  assert((await page.locator("input[name=referencia]").inputValue()) === "12", "referencia prellenada");
  await page.selectOption("select[name=proveedor]", { label: "Ferretería Los Robles" });
  await page.getByLabel("Pagar B0100000901").check();
  await page.getByRole("button", { name: "Registrar pago" }).click();
  await page.waitForURL(/bancos\/[0-9a-f-]+\?aviso=conciliado/);
  paso("el pago registrado desde el cheque queda conciliado y vuelve al banco");

  // Excluir el ajuste informativo
  await fila("AJUSTE INFORMATIVO").getByRole("link", { name: "Buscar o registrar" }).click();
  await page.waitForURL(/\/m\//);
  await page.fill("input[name=motivo]", "Línea informativa del banco");
  await page.getByRole("button", { name: "Excluir" }).click();
  await page.waitForURL(/aviso=excluido/);
  const v = await valores();
  assert(v[2] === "0" && v[1] === "18,310.00" && v[0] === "18,300.00", "cifras finales: " + v);
  await page.goto(cuentaUrl + "?estado=todos", { waitUntil: "networkidle" });
  assert(/Excluido: Línea informativa del banco/.test(await fila("AJUSTE INFORMATIVO").innerText()), "motivo visible");
  await captura("conciliacion-2-todos.png");
  paso("todo conciliado; el ajuste excluido queda a la vista con su motivo");

  // Un pago conciliado no se anula sin desconciliar
  await page.goto(`${B}/e/${eid}/pagos/1`, { waitUntil: "networkidle" });
  const anular = page.locator("form", { has: page.getByRole("button", { name: /Anular/ }) });
  if (await anular.count()) {
    await anular.locator("input, textarea").first().fill("Prueba");
    await anular.getByRole("button", { name: /Anular/ }).click();
    await page.locator("text=desconcílialo en Bancos").waitFor();
    paso("el pago conciliado no se anula: pide desconciliarlo primero");
  }

  // Reporte y cierre de la conciliación de octubre
  await page.goto(cuentaUrl, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Reporte y cierre de la conciliación del mes" }).click();
  await page.waitForURL(/\/conciliacion$/);
  await page.locator("h1", { hasText: "Conciliación de octubre de 2026" }).waitFor();
  const resumen = await page.locator(".resumen-conciliacion").innerText();
  assert(/Saldo según el banco al 31\/10\/2026\s*18,300.00/.test(resumen), "saldo banco: " + resumen);
  assert(/Saldo en libros al 31\/10\/2026\s*18,310.00/.test(resumen), "saldo libros");
  assert(/Diferencia\s*0.00/.test(resumen), "diferencia cero");
  assert(/Excluido: Línea informativa del banco/.test(await page.locator("body").innerText()), "excluido en el reporte");
  const xlsx = await page.request.get(`${B}/e/${eid}/exportar/conciliacion-banco?cuenta=${cuentaUrl.split("/").pop()}&mes=202610`);
  assert(xlsx.status() === 200 && (await xlsx.body()).subarray(0, 2).toString() === "PK", "Excel del reporte");
  const pdf = await page.request.get(`${B}/e/${eid}/exportar/conciliacion-banco?cuenta=${cuentaUrl.split("/").pop()}&mes=202610&formato=pdf`);
  assert(pdf.status() === 200 && (await pdf.body()).subarray(0, 4).toString() === "%PDF", "PDF del reporte");
  await captura("conciliacion-3-reporte.png");
  await page.getByRole("button", { name: "Cerrar la conciliación de octubre de 2026" }).click();
  await page.waitForURL(/cerrado=1/);
  await page.locator("text=Cerrada por Joannie").waitFor();
  paso("reporte de octubre: banco 18,300 y libros 18,310 cuadran (el excluido explica los 10); Excel y PDF; mes cerrado");

  // Un registro nuevo de octubre: avisa que cambió después del cierre
  await page.goto(`${B}/firma/${fid}`, { waitUntil: "networkidle" });
  assert(/Movimientos del banco por conciliar\s*0/.test(await page.locator(".cifras").innerText()), "cifra en el Inicio de la firma");
  paso("el Inicio de la firma muestra los movimientos del banco por conciliar");

  // Celular
  const movil = await (await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() })).newPage();
  await movil.goto(cuentaUrl + "?estado=todos", { waitUntil: "networkidle" });
  const ancho = await movil.evaluate(() => document.documentElement.scrollWidth);
  assert(ancho <= 390, "sin desplazamiento horizontal: " + ancho);
  paso("la conciliación se ve bien en el celular");

  assert(errores.length === 0, "errores en la consola: " + errores.join(" | "));
  await browser.close();
  console.log("Sin errores en el navegador");
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
