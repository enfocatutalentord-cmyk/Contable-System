// Recorrido en el navegador de la Fase 1 (plataforma). Requiere la app corriendo con una base vacía.
// Uso: npm run build && npx next start -p 3100, luego: node pruebas/navegador/fase1.cjs
// PLAYWRIGHT=ruta/a/playwright si no está instalado en el proyecto; BASE=url de la app; CAPTURAS=carpeta de capturas.
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const path = require("node:path");
const fs = require("node:fs");
const S = process.env.CAPTURAS || "/tmp", B = process.env.BASE || "http://localhost:3100";
const assert = (c, m) => { if (!c) throw new Error(m); };
// Archivos de prueba para los adjuntos: un PDF mínimo válido y un ejecutable disfrazado de PDF.
fs.mkdirSync(S, { recursive: true });
fs.writeFileSync(path.join(S, "soporte.pdf"), "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
fs.writeFileSync(path.join(S, "falso.pdf"), "MZ esto no es pdf");

(async () => {
  const browser = await chromium.launch();
  const errores = [];
  const nueva = async (w = 1280) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, acceptDownloads: true });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errores.push(e.message));
    p.on("console", (m) => m.type() === "error" && errores.push(m.text()));
    return p;
  };
  const paso = (t) => console.log("✓", t);
  const page = await nueva();
  const ver = (t) => page.waitForSelector(`text=${t}`, { timeout: 15000 });

  // 1. Alta de la firma
  await page.goto(B + "/registro");
  await page.fill("input[name=nombre]", "Joannie Admin");
  await page.fill("input[name=email]", "admin@firma.do");
  await page.fill("input[name=clave]", "clave-segura-123");
  await page.fill("input[name=firma]", "Firma Prueba SRL");
  await page.click("button.primario");
  await page.waitForURL(/\/firma\/[0-9a-f-]+$/);
  await ver("Todavía no hay clientes");
  paso("registro de la firma y panel vacío");

  // 2. Nuevo cliente con ficha completa
  await page.click("text=+ Nuevo cliente");
  await page.fill("input[name=nombre]", "Comercial Uno SRL");
  await page.fill("input[name=nombre_comercial]", "Uno");
  await page.fill("input[name=rnc]", "131-12345-6");
  await page.selectOption("select[name=regimen]", "rst");
  await page.fill("input[name=actividad_economica]", "Venta de materiales");
  await page.selectOption("select[name=mes_cierre]", "12");
  await page.check("input[name=requiere_aprobacion]");
  await page.click("text=Crear cliente");
  await page.waitForURL(/\/e\/[0-9a-f-]+$/);
  const base = page.url();
  await page.goto(base + "/empresa");
  assert((await page.inputValue("input[name=actividad_economica]")) === "Venta de materiales", "ficha guardada");
  assert((await page.inputValue("select[name=regimen]")) === "rst", "régimen");
  paso("cliente creado con ficha (RNC, régimen RST, actividad, aprobación obligatoria)");
  // Sin aprobación obligatoria para seguir el flujo del administrador; luego se vuelve a activar.
  await page.uncheck("input[name=requiere_aprobacion]");
  await page.click("text=Guardar cambios");
  await ver("Ficha actualizada.");

  // 3. Borrador que no cuadra
  await page.goto(base + "/asientos/nuevo");
  await page.fill("input[name=fecha]", "2026-10-01");
  await page.fill("input[name=concepto]", "Asiento de apertura");
  await page.fill("input[name=referencia]", "AP-001");
  const sel = page.locator("tbody select");
  await sel.nth(0).selectOption({ label: "110103 · Banco cuenta corriente" });
  await page.getByLabel("Debe de la línea 1").fill("100000");
  await sel.nth(1).selectOption({ label: "310101 · Capital suscrito y pagado" });
  await page.getByLabel("Haber de la línea 2").fill("90000");
  assert(await page.getByRole("button", { name: "Contabilizar" }).isDisabled(), "Contabilizar deshabilitado si no cuadra");
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await page.waitForURL(/asientos\/[0-9a-f-]+\?guardado=1/);
  await ver("No cuadra todavía");
  const urlBorrador = page.url().split("?")[0];
  assert((await page.locator("text=Contabilizar").count()) === 0, "no ofrece contabilizar si no cuadra");
  paso("borrador guardado sin cuadrar (sin número)");

  // 4. Editar el borrador y contabilizar
  await page.click("text=Editar");
  await page.getByLabel("Haber de la línea 2").fill("100000");
  await page.getByRole("button", { name: "Contabilizar" }).click();
  await page.waitForURL(/\?contabilizado=1/);
  await ver("Asiento n.º 1");
  paso("borrador editado y contabilizado como n.º 1");

  // 5. Adjuntos: PDF válido sí, archivo disfrazado no
  await page.setInputFiles("input[name=archivo]", path.join(S, "soporte.pdf"));
  await page.fill("input[name=descripcion]", "Acta de aporte");
  await page.click("button:has-text('Adjuntar')");
  await ver("Documento adjuntado.");
  await page.setInputFiles("input[name=archivo]", path.join(S, "falso.pdf"));
  await page.click("button:has-text('Adjuntar')");
  await ver("Solo se aceptan PDF, JPG y PNG.");
  const doc = await page.request.get(base + "/documentos/" + (await page.locator("a[href*='/documentos/']").first().getAttribute("href")).split("/").pop());
  assert(doc.status() === 200 && doc.headers()["content-type"] === "application/pdf", "descarga del adjunto");
  paso("PDF adjuntado y descargable; archivo falso rechazado");

  // 6. Contabilizado no se edita: no hay botón Editar; historial del asiento
  assert((await page.locator("a:has-text('Editar')").count()) === 0, "sin editar en contabilizado");
  await ver("Historial de este asiento");
  const hist = await page.locator("h2:has-text('Historial de este asiento') + .tabla-envoltura").innerText();
  assert(hist.includes("Joannie Admin") && hist.includes("Haber: 90,000.00 → 100,000.00") && hist.includes("Estado: borrador → contabilizado"), "historial con antes/después: " + hist.slice(0, 400));
  paso("historial del asiento con quién, cuándo y antes → después");

  // 7. Duplicado
  await page.goto(base + "/asientos/nuevo");
  await page.fill("input[name=fecha]", "2026-10-02");
  await page.fill("input[name=concepto]", "Otro concepto");
  await page.fill("input[name=referencia]", "AP-001");
  await sel.nth(0).selectOption({ label: "110103 · Banco cuenta corriente" });
  await page.getByLabel("Debe de la línea 1").fill("100000");
  await sel.nth(1).selectOption({ label: "310101 · Capital suscrito y pagado" });
  await page.getByLabel("Haber de la línea 2").fill("100000");
  await page.getByRole("button", { name: "Contabilizar" }).click();
  await ver("Ya existe el asiento n.º 1");
  await page.check("input[name=confirmar_duplicado]");
  await page.getByRole("button", { name: "Contabilizar" }).click();
  await page.waitForURL(/\?contabilizado=1/);
  paso("aviso de duplicado y registro confirmado (n.º 2)");

  // 8. Revertir el n.º 2
  await page.fill("input[name=motivo]", "Registrado por error");
  await page.click("button:has-text('Revertir')");
  await page.waitForURL(/\?revertido=1/);
  await ver("Asiento n.º 3");
  await ver("Revierte a");
  paso("reversión n.º 3 enlazada al n.º 2");

  // 9. Balanza: 100,000 neto (el 2 y el 3 se anulan)
  await page.goto(base + "/balanza?desde=2026-10-01&hasta=2026-10-31");
  const bal = await page.locator("tfoot").innerText();
  assert(bal.includes("300,000.00") && bal.includes("100,000.00"), "balanza: " + bal);
  assert((await page.locator(".aviso").count()) === 0, "balanza cuadra");
  paso("balanza cuadra: movimientos 300,000 y saldo 100,000");

  // 10. Búsqueda avanzada
  await page.goto(base + "/asientos?desde=2026-10-01&hasta=2026-10-31&q=AP-001");
  assert((await page.locator("tbody tr").count()) === 3, "3 asientos con AP-001");
  await page.goto(base + "/asientos?desde=2026-10-01&hasta=2026-10-31&min=150000");
  await ver("0 asientos");
  paso("búsqueda por texto y por monto");

  // 11. Excel y PDF
  for (const [r, extra] of [["diario", "desde=2026-10-01&hasta=2026-10-31"], ["balanza", "desde=2026-10-01&hasta=2026-10-31"], ["asientos", "desde=2026-10-01&hasta=2026-10-31"], ["historial", ""]]) {
    for (const f of ["xlsx", "pdf"]) {
      const resp = await page.request.get(`${base}/exportar/${r}?formato=${f}&${extra}`);
      const cuerpo = await resp.body();
      assert(resp.status() === 200, `${r}.${f} ${resp.status()}`);
      assert(f === "pdf" ? cuerpo.slice(0, 4).toString() === "%PDF" : cuerpo.slice(0, 2).toString() === "PK", `${r}.${f} contenido`);
      if (r === "balanza") fs.writeFileSync(path.join(S, `balanza.${f}`), cuerpo);
    }
  }
  paso("Excel (.xlsx) y PDF de diario, balanza, asientos e historial");

  // 12. Equipo: auxiliar con acceso solo a este cliente; aprobación obligatoria
  await page.goto(base + "/empresa");
  await page.check("input[name=requiere_aprobacion]");
  await page.click("text=Guardar cambios");
  await ver("Ficha actualizada.");
  await page.goto(base + "/usuarios");
  await page.fill("input[name=email]", "aux@firma.do");
  await page.fill("input[name=nombre]", "Ana Auxiliar");
  await page.locator("form:has(input[name=email]) select[name=perfil]").selectOption({ label: "Auxiliar" });
  await page.click("text=Agregar y dar acceso");
  const msg = await page.locator(".exito").innerText();
  // Sin correo configurado en las pruebas, el sistema muestra el enlace de invitación para pasarlo a mano.
  const enlace = msg.match(/https?:\/\/\S+\/acceso\/[A-Za-z0-9_-]+/)[0];
  paso("auxiliar agregada con perfil Auxiliar e invitación por correo");

  const aux = await nueva();
  await aux.goto(enlace);
  await aux.fill("input[name=clave]", "clave-auxiliar-1");
  await aux.fill("input[name=repetida]", "clave-auxiliar-1");
  await aux.click("button.primario");
  await aux.waitForURL(/\/firma\//);
  assert((await aux.locator("text=+ Nuevo cliente").count()) === 0, "auxiliar no crea clientes");
  await aux.goto(base + "/asientos/nuevo");
  assert((await aux.getByRole("button", { name: "Contabilizar" }).count()) === 0, "auxiliar no contabiliza");
  await aux.fill("input[name=fecha]", "2026-10-05");
  await aux.fill("input[name=concepto]", "Pago de alquiler");
  const s2 = aux.locator("tbody select");
  await s2.nth(0).selectOption({ label: "610201 · Alquiler" });
  await aux.getByLabel("Debe de la línea 1").fill("25000");
  await s2.nth(1).selectOption({ label: "110103 · Banco cuenta corriente" });
  await aux.getByLabel("Haber de la línea 2").fill("25000");
  await aux.getByRole("button", { name: "Guardar borrador" }).click();
  await aux.waitForURL(/\?guardado=1/);
  const urlAux = aux.url().split("?")[0];
  assert((await aux.locator("button:has-text('Contabilizar')").count()) === 0, "auxiliar no aprueba");
  const r403 = await aux.request.get(base + "/historial");
  assert((await aux.goto(base + "/historial")) && aux.url().includes("sin_permiso"), "auxiliar sin historial");
  void r403;
  paso("auxiliar: registra borrador, no contabiliza, no ve el historial");

  // El administrador aprueba el borrador de la auxiliar
  await page.goto(B + "/empresas");
  await page.waitForSelector("text=1 asiento en borrador");
  await page.goto(urlAux);
  await page.click("button:has-text('Contabilizar')");
  await page.waitForURL(/\?contabilizado=1/);
  await ver("Asiento n.º 4");
  paso("el administrador aprueba el borrador de la auxiliar (n.º 4); el panel lo mostraba pendiente");

  // 13. Perfiles: quitar «exportar» al Auxiliar
  const fid = (await page.goto(B + "/empresas"), await page.locator("nav a:has-text('Roles y permisos')").getAttribute("href")).split("/")[2];
  await page.goto(`${B}/firma/${fid}/perfiles`);
  const tarjeta = page.locator(".tarjeta", { has: page.locator("h2", { hasText: /^Auxiliar$/ }) });
  await tarjeta.locator("input[value=exportar]").uncheck();
  await tarjeta.locator("button:has-text('Guardar rol')").click();
  await page.waitForSelector("text=Rol actualizado.");
  const r = await aux.request.get(`${base}/exportar/diario?formato=xlsx&desde=2026-10-01&hasta=2026-10-31`);
  assert(r.status() === 403, "sin permiso de exportar: " + r.status());
  paso("perfil editado: el Auxiliar ya no puede descargar reportes");

  // 14. Período cerrado
  await page.goto(base + "/cierres");
  await page.fill("input[name=fecha]", "2026-10-31");
  await page.click("text=Guardar fecha de cierre");
  await ver("Período cerrado hasta el 31/10/2026.");
  await page.goto(base + "/asientos/nuevo");
  await page.fill("input[name=fecha]", "2026-10-20");
  await page.locator("input[name=fecha]").evaluate((el) => el.removeAttribute("min"));
  await page.fill("input[name=concepto]", "Intento en cierre");
  await sel.nth(0).selectOption({ label: "610201 · Alquiler" });
  await page.getByLabel("Debe de la línea 1").fill("1");
  await sel.nth(1).selectOption({ label: "110103 · Banco cuenta corriente" });
  await page.getByLabel("Haber de la línea 2").fill("1");
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await ver("El período está cerrado hasta el 31/10/2026");
  paso("el período cerrado rechaza hasta un borrador");

  // 15. Historial general
  await page.goto(base + "/historial");
  const h = await page.locator("tbody").innerText();
  assert(h.includes("Ana Auxiliar") && h.includes("Modificó empresa") && h.includes("Creó documento") && h.includes("Cerrado hasta"), "historial general: " + h.slice(0, 300));
  await page.screenshot({ path: path.join(S, "f1-historial.png"), fullPage: true });
  paso("historial general con usuarios, empresa, documentos y cierre");

  // 16. Otra firma no ve nada
  const otra = await nueva();
  await otra.goto(B + "/registro");
  await otra.fill("input[name=nombre]", "Intruso");
  await otra.fill("input[name=email]", "intruso@otra.do");
  await otra.fill("input[name=clave]", "clave-segura-456");
  await otra.fill("input[name=firma]", "Otra Firma");
  await otra.click("button.primario");
  await otra.waitForURL(/\/firma\/[0-9a-f-]+$/);
  for (const u of [base, base + "/asientos", urlBorrador, `${base}/exportar/diario?formato=xlsx`, `${B}/firma/${fid}/equipo`]) {
    const x = await otra.request.get(u, { maxRedirects: 0 });
    assert([404, 307].includes(x.status()) && !(await x.text()).includes("Comercial Uno"), `intruso en ${u}: ${x.status()}`);
  }
  paso("otra firma no ve clientes, asientos, documentos, reportes ni el equipo");

  // Capturas
  await page.goto(B + "/empresas"); await page.screenshot({ path: path.join(S, "f1-panel.png"), fullPage: true });
  await page.goto(urlAux); await page.screenshot({ path: path.join(S, "f1-asiento.png"), fullPage: true });
  await page.goto(base + "/asientos?desde=2026-10-01&hasta=2026-10-31"); await page.screenshot({ path: path.join(S, "f1-asientos.png"), fullPage: true });
  await page.goto(`${B}/firma/${fid}/perfiles`); await page.screenshot({ path: path.join(S, "f1-perfiles.png"), fullPage: true });
  await page.goto(base + "/empresa"); await page.screenshot({ path: path.join(S, "f1-ficha.png"), fullPage: true });
  const movil = await nueva(375);
  await movil.context().addCookies(await page.context().cookies());
  for (const u of ["/empresas", base.replace(B, "") + "/asientos", base.replace(B, "") + "/historial"]) {
    await movil.goto(B + u);
    const w = await movil.evaluate(() => document.documentElement.scrollWidth);
    assert(w <= 375, `desborde en celular ${u}: ${w}`);
  }
  paso("sin desborde en celular");
  console.log(errores.length ? "Errores del navegador: " + errores.join(" || ") : "Sin errores en el navegador");
  await browser.close();
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
