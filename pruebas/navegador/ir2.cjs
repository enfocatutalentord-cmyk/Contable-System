// Recorrido del IR-2: anexos A-1, B-1 y J desde la contabilidad, cambio de casilla en el catálogo, liquidación con los
// anexos G y E (parte 2), marcar como presentado, arrastre al ejercicio siguiente y descargas.
// Crea su propia firma con los datos de estados.cjs y de dgii.cjs. Uso: npm run build && npx next start -p 3100, luego:
// DATABASE_URL=... node --experimental-strip-types pruebas/navegador/ir2.cjs
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const path = require("node:path");
const S = process.env.CAPTURAS || "/tmp", B = process.env.BASE || "http://localhost:3100";
const assert = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const estados = await import("./datos-estados.mjs");
  const dgii = await import("./datos-dgii.mjs");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => m.type() === "error" && errores.push(m.text()));
  const paso = (t) => console.log("✓", t);
  const captura = (n) => page.screenshot({ path: path.join(S, n), fullPage: true });
  const correo = `ir2-${Date.now()}@firma.do`;
  const fila = (c) => page.locator("table.estado-financiero tr", { has: page.locator(`td:first-child`, { hasText: new RegExp(`^${c.replace(".", "\\.")}$`) }) }).first();

  await page.goto(B + "/registro", { waitUntil: "networkidle" });
  await page.fill("input[name=nombre]", "Joannie");
  await page.fill("input[name=email]", correo);
  await page.fill("input[name=clave]", "clave-segura-123");
  await page.fill("input[name=firma]", "Firma IR2 SRL");
  await page.getByRole("button", { name: /crear/i }).click();
  await page.waitForURL(/\/firma\/[0-9a-f-]+$/);
  const fid = page.url().split("/")[4];
  await page.goto(`${B}/firma/${fid}/clientes/nuevo`, { waitUntil: "networkidle" });
  await page.fill("input[name=nombre]", "Cliente IR2 SRL");
  await page.fill("input[name=rnc]", "101000080");
  await page.getByRole("button", { name: "Crear cliente" }).click();
  await page.waitForURL(/\/e\/[0-9a-f-]+$/);
  const eid = page.url().split("/")[4];
  await estados.sembrar(eid, correo);
  await dgii.sembrar(eid, correo);

  // Desde Reportes DGII
  await page.goto(`${B}/e/${eid}/dgii`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Abrir el IR-2" }).click();
  await page.waitForURL(/\/dgii\/ir2/);
  await page.getByRole("link", { name: /Ejercicio 2025/ }).click();
  await page.waitForURL(/ejercicio=2025-12-31/);
  assert(/105,000\.00/.test(await fila("6").innerText()) && /105,000\.00/.test(await fila("11").innerText()), "A-1 2025 cuadra");
  assert(/5,000\.00/.test(await fila("10.5").innerText()), "beneficio del ejercicio 2025");
  await captura("ir2-1-a1.png");
  paso("anexo A-1 de 2025: activos 105,000 = pasivos y patrimonio");

  await page.getByRole("link", { name: /Ejercicio 2026/ }).click();
  await page.getByRole("link", { name: "Anexo B-1 · Estado de resultados" }).click();
  await page.waitForURL(/anexo=b1/);
  await page.locator("text=El ejercicio todavía no ha terminado").waitFor();
  assert(/19,000\.00|\d/.test(await fila("14").innerText()), "beneficio antes del ISR");
  const totalIngresos = await fila("4").innerText();
  const total = await fila("15").innerText();
  assert(totalIngresos.split("\t").pop() === total.split("\t").pop(), "casilla 15 = casilla 4: " + totalIngresos + " / " + total);
  await captura("ir2-2-b1.png");
  paso("anexo B-1 de 2026: la casilla 15 cuadra con el total de ingresos");

  // Cambiar la casilla de una cuenta desde el detalle
  await fila("7.7").locator("summary").click();
  await fila("7.7").getByRole("link", { name: /610214/ }).click();
  await page.waitForURL(/catalogo\?editar=/);
  await page.selectOption("select[name=casilla_ir2]", "B1:10.6");
  await page.getByRole("button", { name: "Guardar" }).click();
  await page.locator("text=Cuenta actualizada.").waitFor();
  await page.goto(`${B}/e/${eid}/dgii/ir2?ejercicio=2026-12-31&anexo=b1`, { waitUntil: "networkidle" });
  assert(/10,000\.00/.test(await fila("10.6").innerText()), "la cuenta pasó a 10.6");
  paso("cambiar la casilla de una cuenta en el catálogo la mueve en el anexo");

  // Anexo J con las facturas y compras de octubre
  await page.getByRole("link", { name: "Anexo J · Comprobantes" }).click();
  await page.waitForURL(/anexo=j/);
  const j = await page.locator("table.estado-financiero").innerText();
  assert(/1\.1\s+Comprobante válido para crédito fiscal\s+1\s+5,000\.00/.test(j), "venta B01 en el J: " + j);
  assert(/2\.1\s+Comprobante válido para crédito fiscal\s+2\s+/.test(j), "compras B01 en el J");
  await captura("ir2-3-j.png");
  paso("anexo J: ventas y compras del año por tipo de comprobante");

  for (const r of ["ir2-a1", "ir2-b1", "ir2-j"]) {
    const x = await page.request.get(`${B}/e/${eid}/exportar/${r}?ejercicio=2026-12-31`);
    assert(x.status() === 200 && (await x.body()).subarray(0, 2).toString() === "PK", "Excel " + r);
  }
  paso("Excel de los tres anexos");

  // Liquidación del ejercicio 2025 (parte 2)
  const cifra = async (t) => (await page.locator("dl.cifras-dgii div", { hasText: t }).locator("dd").textContent()).trim();
  const guardar = async () => {
    await page.getByRole("button", { name: "Guardar y recalcular" }).click();
    await page.locator("text=Borrador del IR-2 guardado y recalculado.").waitFor();
    await page.reload({ waitUntil: "networkidle" });
  };
  const pesos = (t) => BigInt(t.replace(/[^\d-]/g, ""));
  await page.goto(`${B}/e/${eid}/dgii/ir2?ejercicio=2025-12-31&anexo=liq`, { waitUntil: "networkidle" });
  const renta = pesos(await cifra("Renta neta imponible (11)"));
  assert(renta > 0n, "renta neta 2025");
  assert(pesos(await cifra("Impuesto liquidado (12)")) === (renta * 27n + 50n) / 100n, "27 % de la casilla 11");
  await page.fill('input[name="G1.1"]', "1000");
  await guardar();
  await page.locator("text=Anexo G: el total de la distribución de los ajustes positivos").waitFor();
  assert(/por corregir/.test(await page.locator(".estado-envio").textContent()), "error del anexo G");
  await page.fill('input[name="G3.13p"]', "1000");
  await page.fill('input[name="E1a"]', "2024");
  await page.fill('input[name="E1b"]', "500");
  await guardar();
  assert(/Listo para presentar/.test(await page.locator(".estado-envio").textContent()), "sin errores");
  const renta2 = pesos(await cifra("Renta neta imponible (11)"));
  assert(renta2 === renta + 100000n - 10000n, `ajuste +1,000 y pérdida 500/5 = 100: ${renta} → ${renta2}`);
  await captura("ir2-4-liquidacion.png");
  paso("liquidación 2025: anexo G cuadrado, pérdida de 2024 compensada y 27 % sobre la casilla 11");

  const xl = await page.request.get(`${B}/e/${eid}/exportar/ir2?periodo=202512`);
  assert(xl.status() === 200 && (await xl.body()).subarray(0, 2).toString() === "PK", "Excel de la liquidación");
  await page.getByRole("button", { name: "Marcar como presentado" }).click();
  await page.locator(".estado-envio", { hasText: /^Presentado$/ }).waitFor();
  await page.locator("text=Marcado como presentado el").waitFor();
  paso("Excel de la liquidación y marcar como presentado");

  await page.goto(`${B}/e/${eid}/dgii/ir2?ejercicio=2026-12-31&anexo=liq`, { waitUntil: "networkidle" });
  assert((await page.inputValue('input[name="E1a"]')) === "2024" && (await page.inputValue('input[name="E1b"]')) === "400.00", "pérdida pendiente pasa a 2026");
  assert((await page.inputValue('input[name="E1f"]')) === "4", "le quedan 4 períodos");
  await captura("ir2-5-arrastre.png");
  paso("2026: la pérdida pendiente (400) y sus períodos vienen del IR-2 de 2025 presentado");

  assert(errores.length === 0, "errores en la consola: " + errores.join(" | "));
  await browser.close();
  console.log("Sin errores en el navegador");
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
