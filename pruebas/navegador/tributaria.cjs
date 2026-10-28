// Recorrido en el navegador de la configuración tributaria (Fase 2). Crea su propia firma, así que no necesita base vacía.
// Uso: npm run build && npx next start -p 3100, luego: node pruebas/navegador/tributaria.cjs
// PLAYWRIGHT=ruta/a/playwright si no está instalado en el proyecto; BASE=url de la app; CAPTURAS=carpeta de capturas.
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const path = require("node:path");
const S = process.env.CAPTURAS || "/tmp", B = process.env.BASE || "http://localhost:3100";
const assert = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const browser = await chromium.launch();
  const errores = [];
  const nueva = async (w = 1280) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errores.push(e.message));
    p.on("console", (m) => m.type() === "error" && errores.push(m.text()));
    return p;
  };
  const paso = (t) => console.log("✓", t);
  const page = await nueva();
  const ver = (t) => page.waitForSelector(`text=${t}`, { timeout: 15000 });
  const captura = (n) => page.screenshot({ path: path.join(S, n), fullPage: true });

  // 1. Firma y cliente del régimen ordinario
  await page.goto(B + "/registro", { waitUntil: "networkidle" });
  await page.fill("input[name=nombre]", "Contadora Fiscal");
  await page.fill("input[name=email]", `fiscal-${Date.now()}@firma.do`);
  await page.fill("input[name=clave]", "clave-segura-123");
  await page.fill("input[name=firma]", "Firma Tributaria SRL");
  await page.click("button.primario");
  await page.waitForURL(/\/firma\/[0-9a-f-]+$/);
  await page.click("text=+ Nuevo cliente");
  await page.fill("input[name=nombre]", "Servicios Dos SRL");
  await page.fill("input[name=rnc]", "101000001");
  await page.click("text=Crear cliente");
  await page.waitForURL(/\/e\/[0-9a-f-]+$/);
  const base = page.url();
  paso("firma y cliente creados");

  // 2. Perfil fiscal y obligaciones sugeridas
  await page.goto(base + "/fiscal", { waitUntil: "networkidle" });
  await ver("Obligaciones ante la DGII");
  assert(await page.isChecked("input[name=contribuye_itbis]"), "contribuyente de ITBIS por defecto");
  assert(await page.isChecked("input[name=agente_retencion]"), "persona jurídica: agente de retención");
  assert(await page.isChecked("input[name=ob_it1]"), "IT-1 sugerido");
  assert(await page.isChecked("input[name=ob_ir17]"), "IR-17 sugerido");
  assert(await page.isChecked("input[name=ob_ir2]"), "IR-2 sugerido");
  assert(!(await page.isChecked("input[name=ob_ir3]")), "IR-3 no se sugiere sin empleados");
  assert(!(await page.isChecked("input[name=ob_ir1]")), "IR-1 no aplica a sociedades");
  assert((await page.locator("text=sin confirmar").count()) > 0, "obligaciones pendientes de confirmar");
  await page.check("input[name=ob_ir3]");
  await page.getByRole("button", { name: "Guardar obligaciones" }).click();
  await ver("Obligaciones guardadas.");
  await page.reload({ waitUntil: "networkidle" });
  assert((await page.locator("text=sin confirmar").count()) === 0, "obligaciones confirmadas");
  assert(await page.isChecked("input[name=ob_ir3]"), "IR-3 guardado");
  await captura("f2-perfil.png");
  paso("perfil fiscal con obligaciones sugeridas, ajustadas y confirmadas");

  // 3. Impuestos: los sugeridos, validación y uno nuevo
  await page.goto(base + "/fiscal/impuestos", { waitUntil: "networkidle" });
  for (const n of ["ITBIS 18 %", "ITBIS 16 %", "Exento"]) await ver(n);
  await page.fill("input[name=nombre]", "Propina legal 10 %");
  await page.selectOption("select[name=tipo]", "propina");
  await page.fill("input[name=tasa]", "10");
  await page.getByRole("button", { name: "Agregar impuesto" }).click();
  await ver("Elige las cuentas de ventas y de compras");
  await page.selectOption("select[name=cuenta_ventas]", { label: "210201 · ITBIS por pagar" });
  await page.selectOption("select[name=cuenta_compras]", { label: "110401 · ITBIS pagado en compras" });
  await page.getByRole("button", { name: "Agregar impuesto" }).click();
  await ver("Impuesto «Propina legal 10 %» agregado.");
  await page.reload({ waitUntil: "networkidle" });
  await ver("Propina legal");
  paso("impuestos sugeridos, validación de cuentas y propina legal agregada");

  // 4. Editar un impuesto y ver su historial
  await page.locator("tr", { hasText: "ITBIS 16 %" }).getByText("Editar").click();
  await page.waitForURL(/impuestos\/[0-9a-f-]+$/);
  await page.waitForLoadState("networkidle");
  await page.fill("input[name=nota]", "Tasa reducida (Ley 253-12). Revisado por la firma.");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.waitForURL(/impuestos\?guardado=1/);
  await ver("Impuesto actualizado.");
  await page.locator("tr", { hasText: "ITBIS 16 %" }).getByText("Editar").click();
  await page.waitForURL(/impuestos\/[0-9a-f-]+$/);
  await ver("Revisado por la firma");
  await ver("Contadora Fiscal");
  paso("impuesto editado y el cambio queda en su historial");

  // 5. Retenciones con vigencia
  await page.goto(base + "/fiscal/retenciones", { waitUntil: "networkidle" });
  await ver("ISR honorarios a personas físicas 15 %");
  const filaVieja = page.locator("tr", { hasText: "ISR honorarios a personas físicas 10 %" });
  assert((await filaVieja.textContent()).includes("Vencida"), "la de 10 % ya no está vigente");
  await page.fill("input[name=nombre]", "ISR alquileres prueba");
  await page.selectOption("select[name=impuesto]", "isr");
  await page.fill("input[name=tasa]", "10");
  await page.selectOption("select[name=codigo_606]", "1");
  await page.selectOption("select[name=cuenta_por_terceros]", { label: "110403 · ISR retenido por terceros" });
  await page.selectOption("select[name=cuenta_a_terceros]", { label: "210203 · ISR retenido a terceros por pagar" });
  await page.fill("input[name=vigente_desde]", "2027-01-01");
  await page.getByRole("button", { name: "Agregar retención" }).click();
  await ver("Retención «ISR alquileres prueba» agregada.");
  await page.reload({ waitUntil: "networkidle" });
  assert((await page.locator("tr", { hasText: "ISR alquileres prueba" }).textContent()).includes("Futura"), "vigencia futura");
  await captura("f2-retenciones.png");
  paso("retenciones con vigencia: vencida, vigente y futura");

  // 6. Comprobantes: NCF y, al ser emisor electrónico, e-CF
  await page.goto(base + "/comprobantes", { waitUntil: "networkidle" });
  assert((await page.locator("option[value=E31]").count()) === 0, "sin e-CF si no es emisor electrónico");
  await page.selectOption("select[name=tipo]", "B01");
  await page.fill("input[name=hasta]", "9999999999");
  await page.getByRole("button", { name: "Agregar rango" }).click();
  await ver("El rango no es válido");
  await page.fill("input[name=hasta]", "500");
  await page.getByRole("button", { name: "Agregar rango" }).click();
  await ver("Rango B01 agregado.");
  await page.goto(base + "/fiscal", { waitUntil: "networkidle" });
  await page.check("input[name=emisor_ecf]");
  await page.fill("input[name=ecf_desde]", "2026-11-01");
  await page.getByRole("button", { name: "Guardar perfil fiscal" }).click();
  await ver("Perfil fiscal guardado.");
  await page.goto(base + "/comprobantes", { waitUntil: "networkidle" });
  await page.selectOption("select[name=tipo]", "E31");
  await page.fill("input[name=hasta]", "2000000000");
  await page.getByRole("button", { name: "Agregar rango" }).click();
  await ver("Rango E31 agregado.");
  await page.reload({ waitUntil: "networkidle" });
  await ver("E310000000001");
  await ver("B0100000001");
  await captura("f2-comprobantes.png");
  paso("rangos B01 (8 dígitos) y E31 (10 dígitos), con e-CF solo para emisores electrónicos");

  // 7. Probar cálculo: venta con retenciones
  await page.goto(base + "/fiscal/probar", { waitUntil: "networkidle" });
  await page.fill("input[name=fecha]", "2026-10-22");
  await page.fill("input[name=monto0]", "10000");
  await page.selectOption("select[name=impuesto0]", { label: "ITBIS 18 % (18 %)" });
  await page.locator("label", { hasText: "ITBIS retenido 30 %" }).locator("input").check();
  await page.locator("label", { hasText: "ISR honorarios a personas físicas 15 %" }).locator("input").check();
  await page.getByRole("button", { name: "Calcular" }).click();
  await ver("Resultado");
  const cifra = async (etiqueta) => (await page.locator(".cifra", { hasText: etiqueta }).locator(".valor").textContent()).trim();
  assert((await cifra("ITBIS")) === "1,800.00", "ITBIS 18 % de 10,000");
  assert((await cifra("Total del comprobante")) === "11,800.00", "total");
  assert((await cifra("Retenido")) === "2,040.00", "540 + 1,500");
  assert((await cifra("Se cobra")) === "9,760.00", "neto");
  assert((await page.locator("text=· cuadra").count()) === 2 && (await page.locator("text=NO CUADRA").count()) === 0, "asientos cuadrados");
  await captura("f2-probar-venta.png");
  paso("venta de 10,000: ITBIS 1,800, retenciones 540 + 1,500, se cobra 9,760 y los dos asientos cuadran");

  // 8. Misma fecha anterior a julio: aplica la tasa vieja
  await page.fill("input[name=fecha]", "2026-06-15");
  await page.getByRole("button", { name: "Calcular" }).click();
  await page.waitForURL(/fecha=2026-06-15/);
  assert((await page.locator("label", { hasText: "ISR honorarios a personas físicas 10 %" }).count()) === 1, "en junio aplica el 10 %");
  assert((await page.locator("label", { hasText: "ISR honorarios a personas físicas 15 %" }).count()) === 0, "en junio no existe el 15 %");
  paso("al cambiar la fecha se ofrecen las tasas vigentes en esa fecha");

  // 9. Compra de un cliente que no es contribuyente de ITBIS: ITBIS y propina van al gasto
  await page.goto(base + "/fiscal", { waitUntil: "networkidle" });
  await page.uncheck("input[name=contribuye_itbis]");
  await page.getByRole("button", { name: "Guardar perfil fiscal" }).click();
  await ver("Perfil fiscal guardado.");
  await page.goto(base + "/fiscal/probar?operacion=compra&fecha=2026-10-22", { waitUntil: "networkidle" });
  await page.fill("input[name=monto0]", "1000");
  await page.selectOption("select[name=impuesto0]", { label: "ITBIS 18 % (18 %)" });
  await page.selectOption("select[name=adicional0]", { label: "Propina legal 10 % (10 %)" });
  await page.getByRole("button", { name: "Calcular" }).click();
  await ver("no está marcado como contribuyente de ITBIS");
  assert((await cifra("Total del comprobante")) === "1,280.00", "1,000 + 180 + 100");
  const gasto = (await page.locator("tr", { hasText: "Gasto, costo o activo" }).first().textContent());
  assert(gasto.includes("1,280.00"), "todo al gasto sin crédito de ITBIS");
  assert((await page.locator("text=NO CUADRA").count()) === 0, "cuadra");
  await captura("f2-probar-compra.png");
  paso("compra sin crédito de ITBIS: ITBIS y propina al gasto, asiento cuadrado");

  // 10. Permiso nuevo en los perfiles de la firma
  await page.goto(B + "/empresas", { waitUntil: "networkidle" });
  const enlace = await page.locator("a[href*='/perfiles']").first().getAttribute("href");
  await page.goto(B + enlace, { waitUntil: "networkidle" });
  await ver("Configurar impuestos, retenciones y comprobantes");
  paso("permiso «Configurar impuestos» disponible en los perfiles");

  // 11. Celular
  const movil = await nueva(390);
  await movil.context().addCookies(await page.context().cookies());
  for (const r of ["/fiscal", "/fiscal/impuestos", "/fiscal/retenciones", "/comprobantes", "/fiscal/probar?operacion=venta&monto0=100"]) {
    await movil.goto(base + r, { waitUntil: "networkidle" });
    const ancho = await movil.evaluate(() => document.documentElement.scrollWidth);
    assert(ancho <= 392, `desborde en ${r}: ${ancho}`);
  }
  paso("sin desborde en celular");

  await browser.close();
  if (errores.length) { console.log("Errores en el navegador:", errores); process.exit(1); }
  console.log("Sin errores en el navegador");
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
