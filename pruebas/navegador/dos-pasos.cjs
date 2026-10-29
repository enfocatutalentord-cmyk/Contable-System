// Recorrido de la verificación en dos pasos: activar con el QR, entrar con el código, código de recuperación, firma que la
// exige y administrador que la quita. Crea su propia firma. El código lo calcula la prueba igual que una app de autenticación.
// Uso: npm run build && npx next start -p 3100, luego: node pruebas/navegador/dos-pasos.cjs
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const S = process.env.CAPTURAS || "/tmp", B = process.env.BASE || "http://localhost:3100";
const assert = (c, m) => { if (!c) throw new Error(m); };
fs.mkdirSync(S, { recursive: true });

// TOTP del RFC 6238 (lo mismo que hace Google Authenticator).
const base32 = (t) => {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, v = 0; const out = [];
  for (const c of t.replace(/\s/g, "")) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
};
const totp = (secreto, desfase = 0) => {
  const m = Buffer.alloc(8);
  m.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + desfase));
  const h = crypto.createHmac("sha1", base32(secreto)).update(m).digest();
  const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
};

(async () => {
  const browser = await chromium.launch();
  const errores = [];
  const nueva = async (ancho = 1280) => {
    const ctx = await browser.newContext({ viewport: { width: ancho, height: 900 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errores.push(e.message));
    return p;
  };
  const paso = (t) => console.log("✓", t);
  const sello = Date.now();
  const correo = `dospasos-${sello}@firma.do`, clave = "clave-segura-123";
  const page = await nueva();
  const boton = (p, nombre) => p.getByRole("button", { name: nombre, exact: true }).click();
  const entrar = async (p, email, c) => {
    await p.goto(B + "/entrar", { waitUntil: "networkidle" });
    await p.fill("input[name=email]", email);
    await p.fill("input[name=clave]", c);
    await boton(p, "Entrar");
  };

  // 1. Registro y configuración con el QR
  await page.goto(B + "/registro", { waitUntil: "networkidle" });
  await page.fill("input[name=nombre]", "Joannie");
  await page.fill("input[name=email]", correo);
  await page.fill("input[name=clave]", clave);
  await page.fill("input[name=firma]", "Firma Dos Pasos SRL");
  await page.click("button.primario");
  await page.waitForURL(/\/firma\/[0-9a-f-]+$/);
  const firma = page.url();
  await page.goto(B + "/cuenta", { waitUntil: "networkidle" });
  await boton(page, "Configurar verificación en dos pasos");
  await page.waitForSelector(".qr-autenticador svg");
  const secreto = (await page.locator("[data-clave]").innerText()).replace(/\s/g, "");
  assert(/^[A-Z2-7]{32}$/.test(secreto), "clave base32 de 160 bits: " + secreto);
  await page.screenshot({ path: path.join(S, "dp-qr.png"), fullPage: true });
  await page.fill("input[name=codigo]", "000000");
  await boton(page, "Activar");
  await page.waitForSelector("text=El código no es correcto");
  await page.fill("input[name=codigo]", totp(secreto));
  await boton(page, "Activar");
  await page.waitForSelector(".codigos-recuperacion");
  const codigos = await page.locator(".codigos-recuperacion code").allInnerTexts();
  assert(codigos.length === 10 && codigos.every((c) => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(c)), "10 códigos de recuperación");
  await page.screenshot({ path: path.join(S, "dp-codigos.png"), fullPage: true });
  assert(!(await page.locator(".qr-autenticador").isVisible()), "con los códigos a la vista se oculta el QR");
  await page.getByRole("link", { name: "Ya los guardé" }).click();
  await page.waitForSelector("text=Te quedan 10 códigos de recuperación");
  assert(!(await page.locator(".codigos-recuperacion").count()), "los códigos no se vuelven a mostrar");
  paso("activada con el QR: código errado rechazado, 10 códigos de recuperación que se muestran una vez");

  // 2. Entrar: después de la contraseña pide el código; sin código no hay sesión
  await page.goto(firma, { waitUntil: "networkidle" });
  await boton(page, "Salir");
  await page.waitForURL(/entrar/);
  await entrar(page, correo, clave);
  await page.waitForURL(/\/entrar\/codigo$/);
  await page.goto(firma, { waitUntil: "networkidle" });
  assert(/\/entrar$/.test(page.url()), "sin el código no hay sesión: " + page.url());
  await entrar(page, correo, clave);
  await page.waitForURL(/\/entrar\/codigo$/);
  await page.screenshot({ path: path.join(S, "dp-entrar-codigo.png"), fullPage: true });
  await page.fill("input[name=codigo]", "123456");
  await boton(page, "Verificar");
  await page.waitForSelector("text=Te quedan 4 intentos");
  const codigoEntrada = totp(secreto, 1); // el siguiente intervalo: el de la activación ya se usó
  await page.fill("input[name=codigo]", codigoEntrada);
  await boton(page, "Verificar");
  await page.waitForURL(/\/firma\//);
  paso("entrar pide el código; sin él no hay sesión; un código errado descuenta intentos");

  // 3. El mismo código no sirve dos veces; un código de recuperación sí, una sola vez
  await boton(page, "Salir");
  await entrar(page, correo, clave);
  await page.waitForURL(/\/entrar\/codigo$/);
  await page.fill("input[name=codigo]", codigoEntrada);
  await boton(page, "Verificar");
  await page.waitForSelector("text=El código no es correcto");
  await page.fill("input[name=codigo]", codigos[0].toUpperCase());
  await boton(page, "Verificar");
  await page.waitForURL(/\/firma\//);
  await boton(page, "Salir");
  await entrar(page, correo, clave);
  await page.waitForURL(/\/entrar\/codigo$/);
  await page.fill("input[name=codigo]", codigos[0]);
  await boton(page, "Verificar");
  await page.waitForSelector("text=El código no es correcto");
  await page.fill("input[name=codigo]", codigos[1]);
  await boton(page, "Verificar");
  await page.waitForURL(/\/firma\//);
  await page.goto(B + "/cuenta", { waitUntil: "networkidle" });
  await page.waitForSelector("text=Te quedan 8 códigos de recuperación");
  paso("un código ya usado no sirve otra vez; los de recuperación sirven una sola vez (quedan 8)");

  // 4. La firma la exige: quien no la tiene va a activarla antes de ver nada
  await page.goto(firma + "/equipo", { waitUntil: "networkidle" });
  const invitada = `exigida-${sello}@firma.do`;
  await page.fill("input[name=email]", invitada);
  await page.fill("input[name=nombre]", "Patricia Prueba");
  await page.locator("form", { has: page.getByRole("button", { name: "Agregar", exact: true }) }).locator("input[name=administrador]").check();
  await boton(page, "Agregar");
  const url = (await page.locator("p.exito").first().innerText()).match(/https?:\/\/\S+\/acceso\/[A-Za-z0-9_-]+/)?.[0];
  assert(url, "enlace de invitación");
  await page.goto(firma + "/clientes", { waitUntil: "networkidle" });
  await page.check("input[name=exigir_dos_pasos]");
  await boton(page, "Guardar datos de la firma");
  await page.waitForSelector("text=Datos de la firma guardados.");
  const p2 = await nueva(390);
  await p2.goto(url, { waitUntil: "networkidle" });
  await p2.fill("input[name=clave]", "mi-clave-nueva-1");
  await p2.fill("input[name=repetida]", "mi-clave-nueva-1");
  await boton(p2, "Guardar contraseña y entrar");
  await p2.waitForURL(/\/cuenta\?exigido=1/);
  await p2.waitForSelector("text=exige la verificación en dos pasos");
  await p2.goto(firma, { waitUntil: "networkidle" });
  assert(/\/cuenta\?exigido=1/.test(p2.url()), "sigue sin poder entrar a la firma: " + p2.url());
  await boton(p2, "Configurar verificación en dos pasos");
  await p2.waitForSelector(".qr-autenticador svg");
  const w = await p2.evaluate(() => document.documentElement.scrollWidth);
  assert(w <= 392, "desborde en celular: " + w);
  const secreto2 = (await p2.locator("[data-clave]").innerText()).replace(/\s/g, "");
  await p2.fill("input[name=codigo]", totp(secreto2));
  await boton(p2, "Activar");
  await p2.waitForSelector(".codigos-recuperacion");
  await p2.getByRole("link", { name: "Ya los guardé" }).click();
  await p2.waitForSelector("text=Te quedan 10");
  await p2.goto(firma, { waitUntil: "networkidle" });
  assert(/\/firma\/[0-9a-f-]+$/.test(p2.url()), "con la verificación activa ya entra: " + p2.url());
  await p2.goto(B + "/cuenta", { waitUntil: "networkidle" });
  assert(!(await p2.getByText("Desactivar la verificación en dos pasos").count()), "si la firma la exige, no se puede desactivar");
  await p2.screenshot({ path: path.join(S, "dp-celular.png"), fullPage: true });
  paso("la firma la exige: la persona nueva la activa antes de ver nada y no la puede quitar (celular sin desborde)");

  // 5. El administrador la quita a quien perdió el celular: se cierran sus sesiones
  await page.goto(firma + "/equipo", { waitUntil: "networkidle" });
  const tarjeta = page.locator(".tarjeta", { hasText: invitada });
  await tarjeta.getByText("verificación en dos pasos activa").waitFor();
  await tarjeta.getByRole("button", { name: "Quitar verificación en dos pasos" }).click();
  await tarjeta.locator("span.error", { hasText: "sin verificación en dos pasos" }).waitFor(); // la firma la exige: queda en rojo
  await p2.goto(firma, { waitUntil: "networkidle" });
  assert(/\/entrar$/.test(p2.url()), "sus sesiones se cerraron: " + p2.url());
  await entrar(p2, invitada, "mi-clave-nueva-1");
  await p2.waitForURL(/\/cuenta\?exigido=1/); // entra sin código y la firma le pide configurarla de nuevo
  paso("el administrador la quita: se cierran sus sesiones y al entrar la configura de nuevo");

  // 6. Sin exigencia, quien la tiene la puede desactivar con contraseña y código
  await page.goto(firma + "/clientes", { waitUntil: "networkidle" });
  await page.uncheck("input[name=exigir_dos_pasos]");
  await boton(page, "Guardar datos de la firma");
  await page.waitForSelector("text=Datos de la firma guardados.");
  await page.goto(B + "/cuenta", { waitUntil: "networkidle" });
  await page.getByText("Desactivar la verificación en dos pasos").click();
  await page.fill("input[name=clave]", "otra-clave-mala");
  await page.locator("form", { has: page.locator("input[name=clave]") }).locator("input[name=codigo]").fill(codigos[2]);
  await boton(page, "Desactivar");
  await page.waitForSelector("text=La contraseña no es correcta");
  await page.fill("input[name=clave]", clave);
  await boton(page, "Desactivar");
  await page.waitForURL(/desactivada=1/);
  await page.waitForSelector("text=Verificación en dos pasos desactivada.");
  await page.goto(firma, { waitUntil: "networkidle" });
  await boton(page, "Salir");
  await entrar(page, correo, clave);
  await page.waitForURL(/\/firma\//);
  paso("desactivar pide contraseña y código; después entra solo con la contraseña");

  await browser.close();
  if (errores.length) { console.log("Errores en el navegador:", errores); process.exit(1); }
  console.log("Sin errores en el navegador");
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
