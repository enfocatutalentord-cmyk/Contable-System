// Recorrido de estados financieros (Fase 7, parte 1): estado de resultados comparado con el año pasado y mes por mes,
// estado de situación financiera que cuadra, clic al libro mayor, firmas y Excel/PDF. Crea su propia firma.
// Uso: npm run build && npx next start -p 3100, luego:
// DATABASE_URL=... node --experimental-strip-types pruebas/navegador/estados.cjs
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const path = require("node:path");
const S = process.env.CAPTURAS || "/tmp", B = process.env.BASE || "http://localhost:3100";
const assert = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const { sembrar } = await import("./datos-estados.mjs");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => m.type() === "error" && errores.push(m.text()));
  const paso = (t) => console.log("✓", t);
  const captura = (n) => page.screenshot({ path: path.join(S, n), fullPage: true });
  const correo = `ef-${Date.now()}@firma.do`;
  const fila = (texto) => page.locator("table.estado-financiero tr", { hasText: texto }).first();

  await page.goto(B + "/registro", { waitUntil: "networkidle" });
  await page.fill("input[name=nombre]", "Joannie");
  await page.fill("input[name=email]", correo);
  await page.fill("input[name=clave]", "clave-segura-123");
  await page.fill("input[name=firma]", "Firma Estados SRL");
  await page.getByRole("button", { name: /crear/i }).click();
  await page.waitForURL(/\/firma\/[0-9a-f-]+$/);
  const fid = page.url().split("/")[4];
  await page.goto(`${B}/firma/${fid}/clientes/nuevo`, { waitUntil: "networkidle" });
  await page.fill("input[name=nombre]", "Cliente Estados SRL");
  await page.fill("input[name=rnc]", "101000070");
  await page.getByRole("button", { name: "Crear cliente" }).click();
  await page.waitForURL(/\/e\/[0-9a-f-]+$/);
  const eid = page.url().split("/")[4];
  await sembrar(eid, correo);

  // Estado de resultados 2026 contra 2025
  await page.goto(`${B}/e/${eid}`, { waitUntil: "networkidle" });
  const boton = page.locator(".menu-boton");
  if (await boton.isVisible()) await boton.click();
  await page.click("nav.menu >> text=Estados financieros");
  await page.waitForURL(/\/estados/);
  await page.fill("input[name=desde]", "2026-01-01");
  await page.fill("input[name=hasta]", "2026-12-31");
  await page.selectOption("select[name=comparar]", "anio");
  await page.getByRole("button", { name: "Ver", exact: true }).click();
  await page.waitForURL(/comparar=anio/);
  const neta = await fila("Utilidad (pérdida) neta del período").innerText();
  assert(/16,000\.00\s+5,000\.00\s+11,000\.00\s+220\.0 %/.test(neta), "utilidad neta comparada: " + neta);
  assert(/19,000\.00/.test(await fila("Utilidad antes del impuesto").innerText()), "antes de ISR");
  await captura("estados-1-resultados.png");
  paso("estado de resultados 2026 vs 2025: utilidad neta 16,000 contra 5,000 (+220 %)");

  // Mes por mes
  await page.selectOption("select[name=comparar]", "meses");
  await page.fill("input[name=hasta]", "2026-03-31");
  await page.getByRole("button", { name: "Ver", exact: true }).click();
  await page.waitForURL(/comparar=meses/);
  const cabeza = await page.locator("table.estado-financiero thead").textContent();
  assert(/ene 2026\s*feb 2026\s*mar 2026\s*Total/.test(cabeza), "columnas por mes: " + cabeza);
  paso("mes por mes: enero, febrero, marzo y total");

  // Estado de situación financiera
  await page.getByRole("link", { name: "Estado de situación financiera" }).click();
  await page.waitForURL(/tipo=balance/);
  await page.fill("input[name=corte]", "2026-12-31");
  await page.selectOption("select[name=comparar]", "ninguno");
  await page.getByRole("button", { name: "Ver", exact: true }).click();
  await page.waitForURL(/corte=2026-12-31/);
  assert(/124,000\.00/.test(await fila("Total activos").innerText()), "activos");
  assert(/124,000\.00/.test(await fila("Total pasivos y patrimonio").innerText()), "pasivo + patrimonio");
  assert(/5,000\.00/.test(await fila("Resultados de ejercicios anteriores").innerText()), "años anteriores");
  assert(/16,000\.00/.test(await fila("Resultado del ejercicio en curso").innerText()), "ejercicio");
  assert(!(await page.locator("text=El activo no es igual").count()), "cuadra");
  await captura("estados-2-balance.png");
  paso("estado de situación al 31/12/2026: activos 124,000 = pasivos y patrimonio 124,000");

  // Flujo de efectivo y cambios en el patrimonio de 2026
  await page.goto(`${B}/e/${eid}/estados?tipo=flujo&desde=2026-01-01&hasta=2026-12-31&comparar=ninguno`, { waitUntil: "networkidle" });
  assert(/19,000\.00/.test(await fila("Efectivo neto de las actividades de operación").innerText()), "flujo de operación");
  assert(/124,000\.00/.test(await fila("Efectivo y equivalentes al final").innerText()), "efectivo final");
  assert(!(await page.locator("text=El efectivo al final no coincide").count()), "el flujo cuadra con el efectivo");
  await captura("estados-3-flujo.png");
  await page.getByRole("link", { name: "Estado de cambios en el patrimonio" }).click();
  await page.waitForURL(/tipo=patrimonio/);
  assert(/121,000\.00/.test(await fila("Saldo al final del período").innerText()), "patrimonio final");
  await captura("estados-4-patrimonio.png");
  paso("flujo de efectivo (indirecto) llega a 124,000 de efectivo; el patrimonio cierra en 121,000 como el balance");
  await page.goto(`${B}/e/${eid}/catalogo`, { waitUntil: "networkidle" });
  assert(/Inversión \(sugerida\)/.test(await page.locator("tr", { hasText: "120105" }).innerText()), "actividad sugerida en el catálogo");
  paso("el catálogo muestra la actividad del flujo de cada cuenta");
  await page.goto(`${B}/e/${eid}/estados?tipo=balance&corte=2026-12-31&comparar=ninguno`, { waitUntil: "networkidle" });

  // Clic al libro mayor
  await fila("110103").getByRole("link").click();
  await page.waitForURL(/\/mayor\?cuenta=/);
  assert((await page.locator("select[name=cuenta] option:checked").textContent()).includes("110103"), "mayor de la 110103");
  paso("tocar una cuenta abre su libro mayor");

  // Firmas y descargas
  await page.goBack({ waitUntil: "networkidle" });
  await page.locator("summary", { hasText: "Firmas del PDF" }).click();
  await page.fill("input[name=firma_preparado]", "Patricia Contadora");
  await page.fill("input[name=firma_icpard]", "12345");
  await page.fill("input[name=firma_aprobado]", "Manaury Gómez");
  await page.fill("input[name=firma_cargo]", "Gerente general");
  await page.getByRole("button", { name: "Guardar firmas" }).click();
  await page.locator("text=Firmas guardadas.").waitFor();
  const q = "tipo=balance&corte=2026-12-31&comparar=anio&agrupar=cuentas";
  const xlsx = await page.request.get(`${B}/e/${eid}/exportar/estado-financiero?${q}`);
  assert(xlsx.status() === 200 && (await xlsx.body()).subarray(0, 2).toString() === "PK", "Excel");
  const pdf = await page.request.get(`${B}/e/${eid}/exportar/estado-financiero?${q}&formato=pdf`);
  assert(pdf.status() === 200 && (await pdf.body()).subarray(0, 4).toString() === "%PDF", "PDF");
  require("node:fs").writeFileSync(path.join(S, "estado-de-situacion.pdf"), await pdf.body());
  paso("firmas guardadas; Excel y PDF del estado de situación comparativo");

  // Cierre del ejercicio 2025 y traspaso a resultados acumulados
  await page.goto(`${B}/e/${eid}/cierres`, { waitUntil: "networkidle" });
  await page.locator("text=Asiento propuesto: utilidad del ejercicio de 5,000.00").waitFor();
  await captura("estados-5-cierre.png");
  await page.getByRole("button", { name: "Contabilizar el cierre del ejercicio 2025" }).click();
  await page.waitForURL(/aviso=cerrado/);
  await page.locator("text=Período cerrado hasta el 31/12/2025").waitFor();
  await page.getByRole("button", { name: "Pasar a resultados acumulados" }).click();
  await page.waitForURL(/aviso=traspasado/);
  await page.locator("text=traspaso: asiento").waitFor();
  await page.goto(`${B}/e/${eid}/estados?tipo=resultados&desde=2025-01-01&hasta=2025-12-31&comparar=ninguno`, { waitUntil: "networkidle" });
  assert(/5,000\.00/.test(await fila("Utilidad (pérdida) neta del período").innerText()), "2025 cerrado sigue mostrando su utilidad");
  await page.goto(`${B}/e/${eid}/estados?tipo=balance&corte=2026-12-31&comparar=ninguno`, { waitUntil: "networkidle" });
  assert(/124,000\.00/.test(await fila("Total pasivos y patrimonio").innerText()) && !(await page.locator("text=El activo no es igual").count()), "el balance sigue cuadrando");
  assert(/5,000\.00/.test(await fila("310301").innerText()), "resultados acumulados");
  paso("cierre del ejercicio 2025: asiento contabilizado, año bloqueado y resultado pasado a resultados acumulados");

  // Centro de reportes
  await page.goto(`${B}/e/${eid}/reportes`, { waitUntil: "networkidle" });
  for (const t of ["Estado de flujos de efectivo", "Balanza de comprobación", "Antigüedad de cuentas por cobrar", "Conciliación bancaria", "IT-1 (ITBIS)"]) {
    assert(await page.getByRole("link", { name: t }).count(), "falta en el centro de reportes: " + t);
  }
  await captura("estados-6-centro.png");
  paso("Centro de reportes con todos los reportes");

  // Celular
  const movil = await (await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() })).newPage();
  await movil.goto(`${B}/e/${eid}/estados?tipo=resultados&desde=2026-01-01&hasta=2026-12-31&comparar=anio`, { waitUntil: "networkidle" });
  const ancho = await movil.evaluate(() => document.documentElement.scrollWidth);
  assert(ancho <= 390, "sin desplazamiento horizontal: " + ancho);
  paso("se ve bien en el celular (la tabla se desplaza dentro de su recuadro)");

  assert(errores.length === 0, "errores en la consola: " + errores.join(" | "));
  await browser.close();
  console.log("Sin errores en el navegador");
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
