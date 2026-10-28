// Recorrido del marco único: Inicio de la firma, selector de cliente, Clientes, Actividad y lo que ve alguien del equipo.
// Crea su propia firma. Uso: npm run build && npx next start -p 3100, luego: node pruebas/navegador/firma.cjs
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const path = require("node:path");
const S = process.env.CAPTURAS || "/tmp", B = process.env.BASE || "http://localhost:3100";
const assert = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  const paso = (t) => console.log("✓", t);
  const ver = (p, texto) => p.waitForSelector(`text=${texto}`, { timeout: 15000 });
  const captura = (p, n) => p.screenshot({ path: path.join(S, n), fullPage: true });
  const sello = Date.now();

  // 1. Registro: entra directo a «Inicio de la firma»; se le cambia el nombre a la firma
  await page.goto(B + "/registro", { waitUntil: "networkidle" });
  await page.fill("input[name=nombre]", "Joannie");
  await page.fill("input[name=email]", `duena-${sello}@firma.do`);
  await page.fill("input[name=clave]", "clave-segura-123");
  await page.fill("input[name=firma]", "Nombre Viejo");
  await page.getByRole("button", { name: /crear/i }).click();
  await page.waitForURL(/\/firma\/[0-9a-f-]+$/);
  const fid = page.url().split("/")[4];
  await ver(page, "Inicio de la firma");
  await page.click("nav >> text=Clientes de la firma");
  await page.waitForURL(/clientes$/);
  await page.fill("input[name=nombre] >> nth=-1", "Empire Tax’N Legal");
  await page.fill("input[name=rnc] >> nth=-1", "131-99999-1");
  await page.getByRole("button", { name: "Guardar datos de la firma" }).click();
  await ver(page, "Datos de la firma guardados.");
  await page.reload({ waitUntil: "networkidle" });
  assert((await page.locator(".barra-cliente").innerText()).includes("Empire Tax’N Legal"), "nombre nuevo arriba");
  paso("registro → Inicio de la firma; nombre y RNC de la firma editables en Clientes");

  // 2. Dos clientes desde «+ Nuevo cliente»
  const ids = {};
  for (const [nombre, rnc] of [["Goemhy Prueba SRL", "101000020"], ["Hotel Coral Prueba", "101000021"]]) {
    await page.goto(`${B}/firma/${fid}/clientes/nuevo`, { waitUntil: "networkidle" });
    await page.fill("input[name=nombre]", nombre);
    await page.fill("input[name=rnc]", rnc);
    await page.getByRole("button", { name: "Crear cliente" }).click();
    await page.waitForURL(/\/e\/[0-9a-f-]+$/);
    ids[nombre] = page.url().split("/")[4];
  }
  assert((await page.locator(".selector-cliente select").inputValue()) === ids["Hotel Coral Prueba"], "el selector muestra el cliente abierto");
  paso("clientes nuevos: al crearlos se abre su resumen con el selector en ese cliente");

  // 3. Selector: mismo menú, cambia de cliente sin salir de la pestaña
  await page.click("nav >> text=Facturas");
  await page.waitForURL(/\/facturas$/);
  await page.selectOption(".selector-cliente select", ids["Goemhy Prueba SRL"]);
  await page.waitForURL(`${B}/e/${ids["Goemhy Prueba SRL"]}/facturas`);
  await captura(page, "firma-cliente.png");
  await page.click("nav >> text=/^Clientes$/");
  await page.waitForURL(/\/clientes$/);
  await page.fill("input[name=nombre]", "Banco Caribe Prueba");
  await page.fill("input[name=rnc]", "101-00000-1");
  await page.getByRole("button", { name: "Guardar cliente" }).click();
  await ver(page, "Cliente Banco Caribe Prueba guardado.");
  await page.selectOption(".selector-cliente select", "");
  await page.waitForURL(`${B}/firma/${fid}`);
  paso("selector: cambia de cliente quedándose en la misma pestaña; «Todos los clientes» vuelve al Inicio de la firma");

  // 4. Con «Todos», una pestaña de cliente pregunta de cuál
  await page.click("nav >> text=Compras y gastos");
  await page.waitForURL(/elegir\?a=/);
  await ver(page, "¿De qué cliente?");
  await captura(page, "firma-elegir.png");
  await page.click(`a[href="/e/${ids["Hotel Coral Prueba"]}/compras"]`);
  await page.waitForURL(`${B}/e/${ids["Hotel Coral Prueba"]}/compras`);
  paso("con «Todos los clientes», tocar una pestaña de cliente pide elegir el cliente y abre esa pestaña");

  // 5. Responsable y actividad
  await page.goto(`${B}/firma/${fid}/clientes`, { waitUntil: "networkidle" });
  const fila = page.locator("tr", { hasText: "Goemhy Prueba SRL" });
  await fila.locator("select[name=responsable]").selectOption({ label: "Joannie" });
  await fila.getByRole("button", { name: "Guardar" }).click();
  await fila.locator("text=Responsable guardado.").waitFor();
  await page.goto(`${B}/firma/${fid}`, { waitUntil: "networkidle" });
  const tabla = await page.locator(".inicio-firma table").innerText();
  assert(tabla.includes("Goemhy Prueba SRL") && tabla.includes("Hotel Coral Prueba") && tabla.includes("Joannie"), "Inicio con clientes y responsable: " + tabla);
  const act = await page.locator(".actividad").innerText();
  assert(act.includes("agregó al cliente Banco Caribe Prueba") && act.includes("Goemhy Prueba SRL"), "actividad: " + act);
  await captura(page, "firma-inicio.png");
  await page.click("text=Ver toda");
  await page.waitForURL(/actividad$/);
  await page.selectOption("select[name=cliente]", ids["Hotel Coral Prueba"]);
  await page.getByRole("button", { name: "Ver" }).click();
  await page.waitForURL(/cliente=/);
  assert(!(await page.locator("tbody").innerText()).includes("Banco Caribe Prueba"), "filtro de actividad por cliente");
  paso("Inicio de la firma: clientes con responsable y pendientes, y la actividad del equipo; Actividad filtra por cliente");

  // 6. Alguien del equipo solo ve sus clientes y no administra
  await page.goto(`${B}/e/${ids["Goemhy Prueba SRL"]}/usuarios`, { waitUntil: "networkidle" });
  const f = page.locator("form", { has: page.getByRole("button", { name: "Agregar y dar acceso" }) });
  await f.locator("input[name=email]").fill(`ana-${sello}@firma.do`);
  await f.locator("input[name=nombre]").fill("Ana del Equipo");
  await f.locator("select[name=perfil]").selectOption({ index: 1 });
  await f.getByRole("button", { name: "Agregar y dar acceso" }).click();
  const enlace = (await f.locator("p.exito").innerText()).match(/https?:\/\/\S+\/acceso\/[A-Za-z0-9_-]+/)[0];
  const ana = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  ana.on("pageerror", (e) => errores.push(e.message));
  await ana.goto(enlace);
  await ana.fill("input[name=clave]", "clave-de-ana-1");
  await ana.fill("input[name=repetida]", "clave-de-ana-1");
  await ana.getByRole("button", { name: "Guardar contraseña y entrar" }).click();
  await ana.waitForURL(/\/firma\/[0-9a-f-]+\?bienvenida=1/);
  const opciones = await ana.locator(".selector-cliente option").allInnerTexts();
  assert(opciones.join("|") === "Todos los clientes|Goemhy Prueba SRL", "Ana solo ve su cliente: " + opciones);
  assert((await ana.locator("nav >> text=Personas y accesos").count()) === 0, "Ana no administra personas");
  await ana.goto(`${B}/firma/${fid}/clientes`);
  assert(ana.url().includes("sin_permiso"), "Ana no entra a Clientes");
  const w = await ana.evaluate(() => document.documentElement.scrollWidth);
  assert(w <= 390, "sin desborde en celular: " + w);
  await ana.locator("nav").getByRole("button", { name: "Salir" }).click();
  await ana.waitForURL(/entrar/);
  paso("equipo: Ana solo ve sus clientes, no administra la firma; en el celular todo cabe y puede salir");

  assert(errores.length === 0, "errores en el navegador: " + errores.join(" | "));
  console.log("Sin errores en el navegador");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
