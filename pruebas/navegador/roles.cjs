// Recorrido de roles con pestañas: la matriz de Roles y permisos, un rol del equipo con pestañas recortadas y un usuario
// de cliente que entra directo a su empresa y solo ve las pestañas de su rol (también si escribe la dirección a mano).
// Crea su propia firma. Uso: npm run build && npx next start -p 3100, luego: node pruebas/navegador/roles.cjs
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const path = require("node:path");
const S = process.env.CAPTURAS || "/tmp", B = process.env.BASE || "http://localhost:3100";
const assert = (c, m) => { if (!c) throw new Error(m); };
// En pantallas angostas el menú está detrás del botón «Menú»: se abre antes de usarlo (en escritorio no hace nada).
const abrirMenu = async (p) => {
  const b = p.locator(".menu-boton");
  if (await b.isVisible() && (await b.getAttribute("aria-expanded")) !== "true") await b.click();
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  const vigilar = (p) => { p.on("pageerror", (e) => errores.push(e.message)); p.on("console", (m) => m.type() === "error" && errores.push(m.text())); };
  vigilar(page);
  const paso = (t) => console.log("✓", t);
  const captura = (p, n) => p.screenshot({ path: path.join(S, n), fullPage: true });
  const sello = Date.now();

  await page.goto(B + "/registro", { waitUntil: "networkidle" });
  await page.fill("input[name=nombre]", "Joannie");
  await page.fill("input[name=email]", `roles-${sello}@firma.do`);
  await page.fill("input[name=clave]", "clave-segura-123");
  await page.fill("input[name=firma]", "Firma Roles SRL");
  await page.getByRole("button", { name: /crear/i }).click();
  await page.waitForURL(/\/firma\/[0-9a-f-]+$/);
  const fid = page.url().split("/")[4];
  await page.goto(`${B}/firma/${fid}/clientes/nuevo`, { waitUntil: "networkidle" });
  await page.fill("input[name=nombre]", "Cliente Roles SRL");
  await page.fill("input[name=rnc]", "101000030");
  await page.getByRole("button", { name: "Crear cliente" }).click();
  await page.waitForURL(/\/e\/[0-9a-f-]+$/);
  const eid = page.url().split("/")[4];

  // 1. Roles y permisos: matriz y roles para clientes ya creados
  await page.click("nav >> text=Roles y permisos");
  await page.waitForURL(/perfiles$/);
  const matriz = await page.locator(".matriz-roles").innerText();
  assert(/cliente · consulta/i.test(matriz) && /cliente · sube documentos/i.test(matriz), "roles para clientes en la matriz: " + matriz.slice(0, 200));
  await captura(page, "roles-matriz.png");
  // Al Auxiliar se le quitan Cierres e Impuestos
  const aux = page.locator(".tarjeta", { has: page.locator("h2", { hasText: /^Auxiliar$/ }) });
  for (const v of ["/cierres", "/fiscal", "/fiscal/impuestos", "/fiscal/retenciones", "/comprobantes", "/fiscal/probar"]) {
    await aux.locator(`input[name=pestanas][value="${v}"]`).uncheck();
  }
  await aux.getByRole("button", { name: "Guardar rol" }).click();
  await aux.locator("text=Rol actualizado.").waitFor();
  await page.reload({ waitUntil: "networkidle" });
  const filaCierres = await page.locator(".matriz-roles tr", { hasText: "Cierre del mes" }).innerText();
  // Columnas: Administrador, Auxiliar, Contador, Facturación, Solo lectura y los dos roles para clientes.
  assert(filaCierres.split("\t").slice(1).map((x) => x.trim()).join(" ") === "✓ — ✓ — ✓ — —", "Cierre del mes por rol: " + filaCierres);
  paso("Roles y permisos: matriz de pestañas por rol, roles para clientes y pestañas editables con casillas");

  // 2. Personas y accesos: un usuario de cliente con cliente y rol en un solo paso
  await page.click("nav >> text=Personas y accesos");
  await page.waitForURL(/equipo$/);
  const f = page.locator("form", { has: page.getByRole("button", { name: "Agregar", exact: true }) });
  await f.locator("input[name=email]").fill(`cliente-${sello}@empresa.do`);
  await f.locator("input[name=nombre]").fill("Dueño del Cliente");
  await f.locator("select[name=empresa]").selectOption(eid);
  await f.locator("select[name=perfil]").selectOption({ label: "Cliente · Consulta" });
  await f.getByRole("button", { name: "Agregar", exact: true }).click();
  const enlace = (await f.locator("p.exito").innerText()).match(/https?:\/\/\S+\/acceso\/[A-Za-z0-9_-]+/)[0];
  await page.reload({ waitUntil: "networkidle" });
  const seccion = await page.locator("section", { has: page.locator("h2", { hasText: "Usuarios de clientes" }) }).innerText();
  assert(seccion.includes("Dueño del Cliente"), "aparece en Usuarios de clientes");
  await captura(page, "roles-personas.png");
  paso("Personas y accesos: equipo y usuarios de clientes por separado; al agregar se elige cliente y rol");

  // 3. El usuario del cliente entra directo a su empresa y solo ve sus pestañas
  const cli = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  vigilar(cli);
  await cli.goto(enlace);
  await cli.fill("input[name=clave]", "clave-cliente-1");
  await cli.fill("input[name=repetida]", "clave-cliente-1");
  await cli.getByRole("button", { name: "Guardar contraseña y entrar" }).click();
  await cli.waitForURL(`${B}/e/${eid}`);
  await abrirMenu(cli);
  const menu = await cli.locator("nav.menu").innerText();
  assert(!menu.includes("Inicio de la firma") && !menu.includes("Asientos") && menu.includes("Facturas") && menu.includes("Cuentas por cobrar"), "menú del cliente: " + menu);
  assert((await cli.locator(".selector-cliente option").allInnerTexts()).join("|") === "Cliente Roles SRL", "sin «Todos los clientes»");
  await captura(cli, "roles-cliente.png");
  await cli.goto(`${B}/e/${eid}/asientos`);
  await cli.waitForSelector("text=Tu rol no incluye esa pestaña");
  assert(cli.url() === `${B}/e/${eid}?sin_pestana=1`, "redirigido al resumen: " + cli.url());
  const r = await cli.request.get(`${B}/e/${eid}/exportar/diario?formato=xlsx`, { maxRedirects: 0 });
  assert(r.status() === 307, "no descarga el diario: " + r.status());
  await cli.goto(`${B}/firma/${fid}`);
  await cli.waitForURL(`${B}/e/${eid}`);
  paso("usuario de cliente: entra directo a su empresa, sin pantallas de la firma, y no abre pestañas ocultas ni por la dirección");

  // 4. Alguien del equipo con el rol Auxiliar no abre Cierres
  await page.goto(`${B}/e/${eid}/usuarios`, { waitUntil: "networkidle" });
  const g = page.locator("form", { has: page.getByRole("button", { name: "Agregar y dar acceso" }) });
  await g.locator("input[name=email]").fill(`aux-${sello}@firma.do`);
  await g.locator("input[name=nombre]").fill("Ana Auxiliar");
  await g.locator("select[name=perfil]").selectOption({ label: "Auxiliar" });
  await g.getByRole("button", { name: "Agregar y dar acceso" }).click();
  const enlace2 = (await g.locator("p.exito").innerText()).match(/https?:\/\/\S+\/acceso\/[A-Za-z0-9_-]+/)[0];
  const ana = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  vigilar(ana);
  await ana.goto(enlace2);
  await ana.fill("input[name=clave]", "clave-de-ana-1");
  await ana.fill("input[name=repetida]", "clave-de-ana-1");
  await ana.getByRole("button", { name: "Guardar contraseña y entrar" }).click();
  await ana.waitForURL(/\/firma\/[0-9a-f-]+\?bienvenida=1/);
  await ana.goto(`${B}/e/${eid}/asientos`);
  await abrirMenu(ana);
  assert((await ana.locator("nav.menu").innerText()).includes("Asientos") && !(await ana.locator("nav.menu").innerText()).includes("Cierre del mes"), "menú de Ana");
  await ana.goto(`${B}/e/${eid}/cierres`);
  await ana.waitForSelector("text=Tu rol no incluye esa pestaña");
  // Quien prepara no aprueba: la Auxiliar no registra cobros (se contabilizan al guardarse).
  await ana.goto(`${B}/e/${eid}/cobros`);
  assert((await ana.locator("text=+ Registrar cobro").count()) === 0, "la Auxiliar no ve «Registrar cobro»");
  await ana.goto(`${B}/e/${eid}/cobros/nuevo`);
  await ana.waitForSelector("text=Tu perfil no permite esa acción");
  const w = await ana.evaluate(() => document.documentElement.scrollWidth);
  assert(w <= 390, "sin desborde en celular: " + w);
  paso("equipo: la Auxiliar ve Asientos pero no el Cierre del mes ni Impuestos, y no registra cobros");

  assert(errores.length === 0, "errores en el navegador: " + errores.join(" | "));
  console.log("Sin errores en el navegador");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
