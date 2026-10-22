// Recorrido en el navegador. Requiere la app corriendo con una base vacía.
// Uso: npm run build && npx next start -p 3100, luego: node pruebas/navegador/fase1.cjs
// PLAYWRIGHT=ruta/a/playwright si no está instalado en el proyecto; BASE=url de la app.
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const S = process.env.CAPTURAS || "/tmp", B = process.env.BASE || "http://localhost:3100";
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => m.type() === "error" && errores.push(m.text()));
  const paso = (t) => console.log("✓", t);

  await page.goto(B + "/registro");
  await page.fill('input[name=nombre]', "Ana Contadora");
  await page.fill('input[name=email]', "ana@prueba.do");
  await page.fill('input[name=clave]', "clave-segura-123");
  await page.fill('input[name=empresa]', "Comercial Prueba SRL");
  await page.fill('input[name=rnc]', "131-12345-6");
  await page.click("button.primario");
  await page.waitForURL(B + "/empresas");
  paso("registro y lista de empresas");
  await page.click("text=Comercial Prueba SRL");
  await page.waitForURL(/\/e\/[0-9a-f-]+$/);
  const base = page.url();
  await page.screenshot({ path: S + "/1-inicio.png", fullPage: true });
  paso("inicio de la empresa");

  // Asiento de apertura
  await page.goto(base + "/asientos/nuevo");
  await page.fill('input[name=fecha]', "2026-10-01");
  await page.fill('input[name=concepto]', "Asiento de apertura");
  const sel = page.locator("tbody select");
  await sel.nth(0).selectOption({ label: "110103 · Banco cuenta corriente" });
  await page.getByLabel("Debe de la línea 1").fill("250,000.00");
  await sel.nth(1).selectOption({ label: "310101 · Capital suscrito y pagado" });
  await page.getByLabel("Haber de la línea 2").fill("200000");
  const boton = page.getByRole("button", { name: "Registrar asiento" });
  if (!(await boton.isDisabled())) throw new Error("Debía estar deshabilitado sin cuadrar");
  await page.click("text=+ Agregar línea");
  await sel.nth(2).selectOption({ label: "210101 · Proveedores locales" });
  await page.locator('button[title="Poner aquí la diferencia"]').nth(2).click();
  if ((await page.getByLabel("Haber de la línea 3").inputValue()) !== "50000.00") throw new Error("Cuadrar no puso 50000.00");
  await page.screenshot({ path: S + "/2-nuevo-asiento.png", fullPage: true });
  await boton.click();
  await page.waitForURL(/asientos\/1\?nuevo=1/);
  paso("asiento 1 registrado con botón de cuadrar");

  // Gasto pagado
  await page.goto(base + "/asientos/nuevo");
  await page.fill('input[name=fecha]', "2026-10-15");
  await page.fill('input[name=concepto]', "Pago de alquiler octubre");
  await sel.nth(0).selectOption({ label: "610201 · Alquiler" });
  await page.getByLabel("Debe de la línea 1").fill("35000");
  await sel.nth(1).selectOption({ label: "110103 · Banco cuenta corriente" });
  await page.getByLabel("Haber de la línea 2").fill("35000");
  await page.getByRole("button", { name: "Registrar asiento" }).click();
  await page.waitForURL(/asientos\/2\?nuevo=1/);
  paso("asiento 2 registrado");

  // Balanza
  await page.goto(base + "/balanza?desde=2026-10-01&hasta=2026-10-31");
  const pie = await page.locator("tfoot td").allInnerTexts();
  console.log("  totales balanza:", pie.join(" | "));
  if (await page.locator(".aviso").count()) throw new Error("La balanza dice que no cuadra");
  await page.screenshot({ path: S + "/3-balanza.png", fullPage: true });
  paso("balanza cuadra");

  // Mayor del banco
  await page.goto(base + "/mayor");
  await page.selectOption('select[name=cuenta]', { label: "110103 · Banco cuenta corriente" });
  await page.fill('input[name=desde]', "2026-10-01");
  await page.fill('input[name=hasta]', "2026-10-31");
  await page.click("button:has-text('Ver')");
  await page.waitForURL(/cuenta=/);
  const saldoFinal = await page.locator("tfoot td").last().innerText();
  if (saldoFinal !== "215,000.00") throw new Error("Saldo banco esperado 215,000.00 y salió " + saldoFinal);
  paso("mayor del banco con saldo 215,000.00");

  // Inicio con cifras
  await page.goto(base);
  console.log("  cifras:", (await page.locator(".cifra").allInnerTexts()).map((t) => t.replace("\n", ": ")).join(" · "));
  paso("cifras de inicio");

  // Exportar
  const resp = await page.request.get(base + "/exportar/balanza?desde=2026-10-01&hasta=2026-10-31");
  const csv = await resp.text();
  if (resp.status() !== 200 || !csv.includes("Totales")) throw new Error("Exportación falló");
  paso("descarga Excel de la balanza");

  // Anular asiento 2
  await page.goto(base + "/asientos/2");
  await page.fill('input[name=motivo]', "Registrado dos veces");
  await page.click("text=Anular asiento >> nth=-1");
  await page.waitForSelector("text=Asiento anulado.");
  paso("asiento 2 anulado");

  // Cerrar período y probar bloqueo
  await page.goto(base + "/cierres");
  await page.fill('input[name=fecha]', "2026-10-31");
  await page.click("text=Guardar fecha de cierre");
  await page.waitForSelector("text=Período cerrado hasta el 31/10/2026.");
  await page.goto(base + "/asientos/nuevo");
  await page.fill('input[name=fecha]', "2026-10-20");
  await page.locator('input[name=fecha]').evaluate((el) => el.removeAttribute("min"));
  await page.fill('input[name=concepto]', "Intento en período cerrado");
  await sel.nth(0).selectOption({ label: "610201 · Alquiler" });
  await page.getByLabel("Debe de la línea 1").fill("10");
  await sel.nth(1).selectOption({ label: "110103 · Banco cuenta corriente" });
  await page.getByLabel("Haber de la línea 2").fill("10");
  await page.getByRole("button", { name: "Registrar asiento" }).click();
  await page.waitForSelector("text=El período está cerrado hasta el 31/10/2026");
  paso("el cierre bloquea asientos en octubre");

  // Catálogo: subcuenta
  await page.goto(base + "/catalogo");
  await page.selectOption('select[name=padre]', { label: "110103 · Banco cuenta corriente" }).catch(() => {});
  await page.selectOption('select[name=padre]', { label: "1101 · Efectivo y equivalentes" });
  await page.fill('input[name=sufijo]', "05");
  await page.fill('input[name=nombre]', "Banco Popular USD");
  await page.click("text=Crear cuenta");
  await page.waitForSelector("text=Cuenta 110105 creada.");
  paso("subcuenta 110105 creada");

  // Usuario auxiliar
  await page.goto(base + "/usuarios");
  await page.fill('input[name=email]', "luis@prueba.do");
  await page.fill('input[name=nombre]', "Luis Auxiliar");
  await page.getByRole("button", { name: "Dar acceso" }).click();

  const msg = await page.locator(".exito").innerText();
  const temporal = msg.match(/: (\S+) \(cópiala/)[1];
  paso("auxiliar creado con clave temporal");
  await page.screenshot({ path: S + "/4-usuarios.png", fullPage: true });

  // Entrar como auxiliar: no puede cerrar ni editar catálogo
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(B + "/entrar");
  await p2.fill('input[name=email]', "luis@prueba.do");
  await p2.fill('input[name=clave]', temporal);
  await p2.click("button.primario");
  await p2.waitForURL(B + "/empresas");
  await p2.goto(base + "/cierres");
  if (await p2.locator("text=Guardar fecha de cierre").count()) throw new Error("El auxiliar no debe cerrar");
  await p2.goto(base + "/catalogo");
  if (await p2.locator("text=Nueva subcuenta").count()) throw new Error("El auxiliar no debe editar el catálogo");
  paso("el auxiliar no ve cierre ni edición de catálogo");

  // Otra persona sin acceso no entra a la empresa
  const ctx3 = await browser.newContext();
  const p3 = await ctx3.newPage();
  await p3.goto(B + "/registro");
  await p3.fill('input[name=nombre]', "Intruso");
  await p3.fill('input[name=email]', "intruso@prueba.do");
  await p3.fill('input[name=clave]', "clave-segura-456");
  await p3.fill('input[name=empresa]', "Otra SRL");
  await p3.click("button.primario");
  await p3.waitForURL(B + "/empresas");
  const r = await p3.goto(base + "/balanza");
  if (r.status() !== 404) throw new Error("Intruso recibió " + r.status());
  const r2 = await p3.request.get(base + "/exportar/diario");
  if (r2.status() !== 404) throw new Error("Intruso descargó: " + r2.status());
  paso("otra cuenta no puede ver la empresa ni descargar (404)");

  // Celular
  const movil = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await movil.context().addCookies(await page.context().cookies());
  await movil.goto(base + "/balanza?desde=2026-10-01&hasta=2026-10-31");
  const anchoPagina = await movil.evaluate(() => document.documentElement.scrollWidth);
  await movil.screenshot({ path: S + "/5-movil.png", fullPage: true });
  console.log("  ancho de página en celular:", anchoPagina);

  console.log(errores.length ? "Errores del navegador: " + errores.join(" || ") : "Sin errores en el navegador");
  await browser.close();
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
