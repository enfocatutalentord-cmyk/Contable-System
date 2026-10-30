// Graba el video demo de la plataforma, escena por escena, al ritmo de la voz: cada escena dura lo que dura su audio.
// Deja el video sin sonido y <carpeta>/tiempos.json con el segundo en que empieza cada escena (para mezclar la voz).
// Uso: PLAYWRIGHT=... node grabar.cjs <carpeta con demo.json y voz/>
const { chromium } = require(process.env.PLAYWRIGHT);
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { abrir } = require("../guion.cjs");
const B = "http://localhost:3100";
const dir = process.argv[2];
const demo = JSON.parse(fs.readFileSync(path.join(dir, "demo.json"), "utf8"));
const escenas = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, "escenas.json"), "utf8")).map(([id, , sub]) => [id, sub]));
const dur = (id) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(dir, "voz", `${id}.mp3`)]).toString());

(async () => {
  // La sesión se abre fuera de la grabación.
  const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const p0 = await br.newPage();
  await p0.goto(B + "/entrar");
  await p0.fill("input[name=email]", demo.correo);
  await p0.fill("input[name=clave]", "clave-segura-123");
  await p0.getByRole("button", { name: /entrar/i }).click();
  await p0.waitForURL(/\/firma\//);
  const cookies = await p0.context().cookies();
  await br.close();

  const t = await abrir("demo", path.join(dir, "tmp"), { cookies });
  const { page } = t;
  const tiempos = [];
  const nav = (texto) => page.locator("nav a", { hasText: new RegExp(`^${texto}$`) }).first();
  // Cada escena: subtítulo, acciones y espera hasta que termine su voz (más una pausa corta).
  const escena = async (id, acciones) => {
    const desde = Date.now();
    tiempos.push([id, (desde - t.inicio) / 1000]);
    if (escenas[id]) await t.sub(escenas[id], 0);
    await acciones();
    const falta = dur(id) * 1000 + 600 - (Date.now() - desde);
    if (falta > 0) await t.espera(falta);
  };

  await t.ir(`/firma/${demo.firma}`);
  await escena("01", async () => {
    await t.tarjetaHtml(`<h1>Sistema contable</h1><p>Para firmas contables que llevan varios clientes</p>
      <p style="color:#F6F3EC;font-size:19px;margin-top:18px">Contabilidad · Facturación · Compras · Impuestos DGII</p>`);
  });
  await t.tarjetaFuera();
  await escena("02", async () => { await t.señalar(page.locator(".cifras")); });
  await escena("03", async () => { await t.soltar(); await t.señalar(page.locator(".inicio-firma table").first()); });
  await escena("04", async () => {
    await t.soltar();
    await t.clic(nav("Documentos recibidos"));
    await t.señalar(page.locator("table").first());
  });
  await escena("05", async () => {
    await t.soltar();
    await t.elegir(page.locator(".selector-cliente select"), { label: "Ferretería Los Robles SRL" });
    await page.waitForURL(/\/e\//); await page.waitForLoadState("networkidle"); await page.evaluate(() => 0);
    await t.ir(new URL(page.url()).pathname);
    await t.señalar(page.locator("nav.menu"));
  });
  await escena("06", async () => {
    await t.soltar();
    await t.clic(nav("Facturas"));
    await t.señalar(page.locator("table").first());
  });
  await escena("07", async () => { await t.soltar(); await t.señalar(page.locator(".descargar").first()); });
  await escena("08", async () => {
    await t.soltar();
    await t.clic(nav("Cuentas por cobrar"));
    await t.señalar(page.locator("table").first());
  });
  await escena("09", async () => {
    await t.soltar();
    await t.clic(nav("Compras y gastos"));
    await t.señalar(page.locator("table").first());
    await t.soltar();
    await t.clic(nav("Pagos"));
    await t.señalar(page.locator("table").first());
  });
  await escena("10", async () => {
    await t.soltar();
    await t.clic(nav("Balanza de comprobación"));
    await t.señalar(page.locator("table").first());
  });
  await escena("11", async () => {
    await t.soltar();
    await t.clic(nav("Reportes DGII"));
    await t.señalar(page.locator("input[name=mes]"));
    await t.onda();
    await page.locator("input[name=mes]").fill("2026-10");
    await t.espera(500);
    await t.clic(page.getByRole("button", { name: "Ver", exact: true }));
    await t.señalar(page.locator("#f606"));
    await t.soltar();
    await t.señalar(page.locator("#f607 .boton.primario, #f607 .descargar").first());
  });
  await escena("12", async () => {
    await t.soltar();
    await t.clic(page.getByRole("link", { name: "Abrir el IT-1 de 202610" }));
    await t.señalar(page.locator(".cifras-dgii"));
    await t.soltar();
    await t.señalar(page.locator(".tabla-it1").first());
  });
  await escena("13", async () => {
    await t.soltar();
    await t.clic(nav("Roles y permisos"));
    await t.señalar(page.locator(".matriz-roles").first());
  });
  await t.soltar(); await t.sub("", 0);
  await escena("14", async () => {
    await t.tarjetaHtml(`<h1>Lo que viene</h1>
      <ul style="font-size:23px;line-height:1.75;text-align:left;margin:14px 0 0;color:#F6F3EC">
        <li><b style="color:#e3c27f">Factura electrónica (e-CF)</b> con un proveedor autorizado por la DGII</li>
        <li><b style="color:#e3c27f">Conciliación bancaria</b> con los estados de cuenta</li>
        <li><b style="color:#e3c27f">Estados financieros</b> y declaración anual de renta (IR-2)</li>
        <li><b style="color:#e3c27f">Asistente con inteligencia artificial</b> según el rol de cada persona</li>
      </ul>`);
  });
  await escena("15", async () => {
    await t.tarjetaHtml(`<h1>Empire Tax’N Legal</h1><p>La contabilidad y los impuestos de tus clientes, en orden y al día.</p>`);
  });
  await t.espera(1200);
  fs.writeFileSync(path.join(dir, "tiempos.json"), JSON.stringify(tiempos));
  await t.cerrar(path.join(dir, "demo.webm"));
  console.log("grabado", tiempos.map(([i, s]) => `${i}@${s.toFixed(1)}`).join(" "));
})().catch((e) => { console.error(e); process.exit(1); });
