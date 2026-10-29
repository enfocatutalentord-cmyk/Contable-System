// Recorrido de documentos recibidos (parte 3): el cliente sube fotos y PDF desde su portal, la firma los ve en su bandeja,
// registra una compra con el documento como soporte y descarta otro con un motivo que el cliente ve.
// Crea su propia firma. Uso: npm run build && npx next start -p 3100, luego: node pruebas/navegador/documentos.cjs
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const path = require("node:path");
const S = process.env.CAPTURAS || "/tmp", B = process.env.BASE || "http://localhost:3100";
const assert = (c, m) => { if (!c) throw new Error(m); };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  const vigilar = (p) => { p.on("pageerror", (e) => errores.push(e.message)); p.on("console", (m) => m.type() === "error" && errores.push(m.text())); };
  vigilar(page);
  const paso = (t) => console.log("✓", t);
  const captura = (p, n) => p.screenshot({ path: path.join(S, n), fullPage: true });
  const sello = Date.now();

  // Firma, cliente y un proveedor
  await page.goto(B + "/registro", { waitUntil: "networkidle" });
  await page.fill("input[name=nombre]", "Joannie");
  await page.fill("input[name=email]", `docs-${sello}@firma.do`);
  await page.fill("input[name=clave]", "clave-segura-123");
  await page.fill("input[name=firma]", "Firma Documentos SRL");
  await page.getByRole("button", { name: /crear/i }).click();
  await page.waitForURL(/\/firma\/[0-9a-f-]+$/);
  const fid = page.url().split("/")[4];
  await page.goto(`${B}/firma/${fid}/clientes/nuevo`, { waitUntil: "networkidle" });
  await page.fill("input[name=nombre]", "Cliente Documentos SRL");
  await page.fill("input[name=rnc]", "101000040");
  await page.getByRole("button", { name: "Crear cliente" }).click();
  await page.waitForURL(/\/e\/[0-9a-f-]+$/);
  const eid = page.url().split("/")[4];
  await page.goto(`${B}/e/${eid}/proveedores`, { waitUntil: "networkidle" });
  await page.fill("input[name=nombre]", "Ferretería Prueba SRL");
  await page.fill("input[name=rnc]", "101-00000-3");
  await page.selectOption("select[name=tipo_gasto]", "02");
  await page.getByRole("button", { name: "Guardar proveedor" }).click();
  await page.waitForSelector("text=Proveedor Ferretería Prueba SRL guardado.");

  // 1. Usuario del cliente con «Cliente · Sube documentos»
  await page.goto(`${B}/firma/${fid}/equipo`, { waitUntil: "networkidle" });
  const f = page.locator("form", { has: page.getByRole("button", { name: "Agregar", exact: true }) });
  await f.locator("input[name=email]").fill(`cliente-${sello}@empresa.do`);
  await f.locator("input[name=nombre]").fill("Dueña del Cliente");
  await f.locator("select[name=empresa]").selectOption(eid);
  await f.locator("select[name=perfil]").selectOption({ label: "Cliente · Sube documentos" });
  await f.getByRole("button", { name: "Agregar", exact: true }).click();
  const enlace = (await f.locator("p.exito").innerText()).match(/https?:\/\/\S+\/acceso\/[A-Za-z0-9_-]+/)[0];
  const cli = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  vigilar(cli);
  await cli.goto(enlace);
  await cli.fill("input[name=clave]", "clave-cliente-1");
  await cli.fill("input[name=repetida]", "clave-cliente-1");
  await cli.getByRole("button", { name: "Guardar contraseña y entrar" }).click();
  await cli.waitForURL(`${B}/e/${eid}`);
  const menu = await cli.locator("nav.menu").innerText();
  assert(menu.includes("Mis documentos") && !menu.includes("Compras y gastos") && !menu.includes("Facturas"), "menú del cliente: " + menu);
  paso("el cliente con «Sube documentos» solo ve su resumen y «Mis documentos»");

  // 2. Sube dos documentos desde el celular; el mismo archivo no se sube dos veces
  await cli.click("nav >> text=Mis documentos");
  await cli.waitForURL(/recepcion/);
  const subir = cli.locator("form", { has: cli.getByRole("button", { name: "Subir" }) });
  await subir.locator("input[name=archivos]").setInputFiles([
    { name: "recibo-gasolina.png", mimeType: "image/png", buffer: PNG },
    { name: "factura-ferreteria.pdf", mimeType: "application/pdf", buffer: PDF },
  ]);
  await subir.locator("input[name=nota]").fill("Pagado con la tarjeta de la empresa");
  await subir.getByRole("button", { name: "Subir" }).click();
  await subir.locator("text=2 documentos recibidos").waitFor();
  await subir.locator("input[name=archivos]").setInputFiles([{ name: "otra-vez.png", mimeType: "image/png", buffer: PNG }]);
  await subir.getByRole("button", { name: "Subir" }).click();
  await subir.locator("text=ya se había subido").waitFor();
  await cli.reload({ waitUntil: "networkidle" });
  assert((await cli.locator("tbody tr").count()) === 2, "el cliente ve sus 2 documentos");
  const w = await cli.evaluate(() => document.documentElement.scrollWidth);
  assert(w <= 390, "sin desborde en celular: " + w);
  await captura(cli, "docs-cliente.png");
  await cli.goto(`${B}/e/${eid}/compras`);
  await cli.waitForSelector("text=Tu rol no incluye esa pestaña");
  paso("el cliente sube 2 documentos con una nota, no repite archivos y no entra a Compras");

  // 3. La firma los ve: Inicio, bandeja de todos los clientes y actividad
  await page.goto(`${B}/firma/${fid}`, { waitUntil: "networkidle" });
  assert((await page.locator(".inicio-firma table").innerText()).includes("2 documentos por procesar"), "Inicio con documentos por procesar");
  assert((await page.locator(".actividad").innerText()).includes("subió «recibo-gasolina.png»"), "actividad");
  await page.click("nav >> text=Documentos recibidos");
  await page.waitForURL(/\/firma\/[0-9a-f-]+\/documentos$/);
  assert((await page.locator("tbody tr").count()) === 2, "bandeja de la firma");
  await captura(page, "docs-firma.png");
  paso("la firma ve los documentos en el Inicio, en su bandeja y en la actividad");

  // 4. Registrar la compra con el documento como soporte
  await page.goto(`${B}/e/${eid}/recepcion`, { waitUntil: "networkidle" });
  await captura(page, "docs-bandeja.png");
  await page.locator("tr", { hasText: "factura-ferreteria.pdf" }).getByRole("link", { name: "Registrar compra con este documento" }).click();
  await page.waitForURL(/compras\/nueva\?recepcion=/);
  await page.waitForSelector("text=Registrando el documento");
  await page.selectOption("select[name=proveedor]", { label: "Ferretería Prueba SRL · 101000003" });
  await page.fill("input[name=ncf]", "B0100000555");
  await page.getByLabel("Descripción de la línea 1").fill("Materiales de oficina");
  await page.getByLabel("Precio de la línea 1").fill("1,000");
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await page.waitForURL(/compras\/[0-9a-f-]+\?guardada=1/);
  await page.waitForSelector("text=factura-ferreteria.pdf");
  await page.goto(`${B}/e/${eid}/recepcion?estado=procesado`, { waitUntil: "networkidle" });
  assert((await page.locator("tbody").innerText()).includes("Compra"), "procesado con enlace a la compra");
  paso("«Registrar compra con este documento»: la compra queda con el archivo como soporte y el documento pasa a Procesado");

  // 5. Descartar el otro con un motivo que el cliente ve
  await page.goto(`${B}/e/${eid}/recepcion`, { waitUntil: "networkidle" });
  const fila = page.locator("tr", { hasText: "recibo-gasolina.png" });
  await fila.locator("form", { has: page.getByRole("button", { name: "Descartar" }) }).locator("input[name=respuesta]").fill("Está borroso, súbelo otra vez");
  await fila.getByRole("button", { name: "Descartar" }).click();
  await page.waitForSelector("text=No hay documentos por procesar.");
  await cli.goto(`${B}/e/${eid}/recepcion`, { waitUntil: "networkidle" });
  const vista = await cli.locator("tbody").innerText();
  assert(vista.includes("Descartado") && vista.includes("Está borroso") && vista.includes("Procesado"), "el cliente ve los estados: " + vista);
  const archivo = await cli.request.get(`${B}${await cli.locator("tbody a").first().getAttribute("href")}`);
  assert(archivo.status() === 200, "el cliente abre su archivo");
  paso("descartado con motivo: el cliente ve «Procesado», «Descartado» y la respuesta de la firma");

  assert(errores.length === 0, "errores en el navegador: " + errores.join(" | "));
  console.log("Sin errores en el navegador");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
