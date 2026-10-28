// Recorrido del acceso por correo: invitación con enlace, crear contraseña, entrar, reenviar y «¿Olvidaste tu contraseña?».
// Crea su propia firma. Sin GMAIL_CLAVE_APP el correo no sale y el sistema muestra el enlace para pasarlo a mano:
// así lo prueba este recorrido. Uso: npm run build && npx next start -p 3100, luego: node pruebas/navegador/acceso.cjs
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const path = require("node:path");
const S = process.env.CAPTURAS || "/tmp", B = process.env.BASE || "http://localhost:3100";
const assert = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  admin.on("pageerror", (e) => errores.push(e.message));
  const paso = (t) => console.log("✓", t);
  const sello = Date.now();
  const invitada = `invitada-${sello}@firma.do`;

  // 1. La administradora crea su firma y agrega a una persona nueva
  await admin.goto(B + "/registro", { waitUntil: "networkidle" });
  await admin.fill("input[name=nombre]", "Joannie");
  await admin.fill("input[name=email]", `admin-${sello}@firma.do`);
  await admin.fill("input[name=clave]", "clave-segura-123");
  await admin.fill("input[name=firma]", "Firma Acceso SRL");
  await admin.getByRole("button", { name: /crear/i }).click();
  await admin.waitForURL(/empresas/);
  await admin.click("text=Equipo");
  await admin.waitForURL(/equipo/);
  await admin.fill("input[name=email]", invitada);
  await admin.fill("input[name=nombre]", "Patricia Prueba");
  await admin.check("form >> nth=0 >> input[name=administrador]");
  await admin.getByRole("button", { name: "Agregar", exact: true }).click();
  const aviso = admin.locator("p.exito").first();
  await aviso.waitFor();
  const texto = await aviso.innerText();
  assert(!/temporal/i.test(texto), "ya no se muestran contraseñas temporales");
  const url = texto.match(/https?:\/\/\S+\/acceso\/[A-Za-z0-9_-]+/)?.[0];
  assert(url, "sin correo configurado, se muestra el enlace para pasarlo a mano: " + texto);
  await admin.goto(B + "/firma/" + admin.url().split("/")[4] + "/equipo", { waitUntil: "networkidle" });
  await admin.waitForSelector("text=correo sin verificar");
  paso("invitación: la persona queda en el equipo con «correo sin verificar» y el enlace de un solo uso");

  // 2. La persona abre el enlace: no puede entrar con ninguna clave hasta crear la suya
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errores.push(e.message));
  await p.goto(url, { waitUntil: "networkidle" });
  await p.waitForSelector("text=Tu correo quedó verificado");
  await p.goto(url, { waitUntil: "networkidle" });
  await p.waitForSelector("text=Tu correo quedó verificado"); // mirar la página no gasta el enlace
  await p.fill("input[name=clave]", "mi-clave-nueva-1");
  await p.fill("input[name=repetida]", "otra-clave-9999");
  await p.getByRole("button", { name: "Guardar contraseña y entrar" }).click();
  await p.waitForSelector("text=no coinciden");
  await p.fill("input[name=clave]", "mi-clave-nueva-1");
  await p.fill("input[name=repetida]", "mi-clave-nueva-1");
  await p.getByRole("button", { name: "Guardar contraseña y entrar" }).click();
  await p.waitForURL(/empresas\?bienvenida=1/);
  await p.waitForSelector("text=tu contraseña quedó guardada");
  await p.screenshot({ path: path.join(S, "acceso-bienvenida.png") });
  paso("enlace: verifica el correo, pide la contraseña dos veces y entra");

  // 3. El enlace ya no sirve; entra con su correo y su contraseña
  await p.goto(url, { waitUntil: "networkidle" });
  await p.waitForSelector("text=Este enlace ya no sirve");
  await p.goto(B + "/empresas", { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Salir" }).click();
  await p.waitForURL(/entrar/);
  await p.fill("input[name=email]", invitada);
  await p.fill("input[name=clave]", "mi-clave-nueva-1");
  await p.getByRole("button", { name: "Entrar" }).click();
  await p.waitForURL(/empresas/);
  paso("el enlace sirve una sola vez; después entra con su correo y su contraseña");

  // 4. El equipo la muestra verificada; la administradora le puede mandar un enlace nuevo
  await admin.reload({ waitUntil: "networkidle" });
  const tarjeta = admin.locator(".tarjeta", { hasText: invitada });
  await tarjeta.locator("text=correo verificado").waitFor();
  await tarjeta.getByRole("button", { name: "Enviar enlace para nueva contraseña" }).click();
  const aviso2 = await tarjeta.locator("p.exito").innerText();
  const url2 = aviso2.match(/https?:\/\/\S+\/acceso\/[A-Za-z0-9_-]+/)?.[0];
  assert(url2 && url2 !== url, "enlace nuevo para una nueva contraseña");
  paso("Equipo: «correo verificado» y botón para enviarle un enlace de nueva contraseña");

  // 5. «¿Olvidaste tu contraseña?» responde igual exista o no la cuenta, y el enlace anterior queda sin efecto
  await p.getByRole("button", { name: "Salir" }).click();
  await p.click("text=¿Olvidaste tu contraseña?");
  await p.waitForURL(/recuperar/);
  for (const correo of [invitada, `nadie-${sello}@firma.do`]) {
    await p.fill("input[name=email]", correo);
    await p.getByRole("button", { name: "Enviar enlace" }).click();
    await p.waitForSelector(`text=Si ${correo} tiene una cuenta`);
  }
  await p.goto(url2, { waitUntil: "networkidle" });
  await p.waitForSelector("text=Este enlace ya no sirve");
  paso("«¿Olvidaste tu contraseña?»: misma respuesta para cualquier correo; un enlace nuevo anula el anterior");

  // 6. Por usuarios de un cliente también se invita por correo
  await admin.goto(B + "/empresas", { waitUntil: "networkidle" });
  await admin.click("text=+ Nuevo cliente");
  await admin.fill("input[name=nombre]", "Cliente Acceso SRL");
  await admin.fill("input[name=rnc]", "101000010");
  await admin.getByRole("button", { name: /crear|guardar/i }).first().click();
  await admin.waitForURL(/\/e\/[0-9a-f-]+$/);
  await admin.goto(admin.url() + "/usuarios", { waitUntil: "networkidle" });
  const f = admin.locator("form", { has: admin.getByRole("button", { name: "Agregar y dar acceso" }) });
  await f.locator("input[name=email]").fill(`auxiliar-${sello}@firma.do`);
  await f.locator("input[name=nombre]").fill("Auxiliar Prueba");
  await f.locator("select[name=perfil]").selectOption({ index: 1 });
  await f.getByRole("button", { name: "Agregar y dar acceso" }).click();
  const aviso3 = await f.locator("p.exito").innerText();
  assert(/Acceso creado/.test(aviso3) && /\/acceso\//.test(aviso3) && !/temporal/i.test(aviso3), "invitación desde el cliente: " + aviso3);
  paso("Usuarios y permisos de un cliente: también invita por correo, sin contraseñas temporales");

  assert(errores.length === 0, "errores en el navegador: " + errores.join(" | "));
  console.log("Sin errores en el navegador");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
