// Prepara la firma de muestra del video demo (sin grabar): crea la cuenta, la firma y dos clientes ficticios desde la
// app, y luego carga sus movimientos con datos.mjs. Deja el correo y las direcciones en <carpeta>/demo.json.
// Uso: DATABASE_URL=... node herramientas/videos/demo/preparar.cjs <carpeta>
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const B = process.env.BASE || "http://localhost:3100";
(async () => {
  const dir = process.argv[2];
  const correo = `joannie-demo-${Date.now()}@empire.do`;
  const br = await chromium.launch();
  const page = await br.newPage();
  await page.goto(B + "/registro");
  await page.fill("input[name=nombre]", "Joannie");
  await page.fill("input[name=email]", correo);
  await page.fill("input[name=clave]", "clave-segura-123");
  await page.fill("input[name=firma]", "Empire Tax’N Legal");
  await page.click("button.primario");
  await page.waitForURL(/\/firma\/[0-9a-f-]+$/);
  const firma = page.url().split("/firma/")[1];
  const empresas = [];
  for (const [nombre, rnc] of [["Ferretería Los Robles SRL", "101000101"], ["Clínica Dental Sonrisa SRL", "101000102"]]) {
    await page.goto(`${B}/firma/${firma}/clientes/nuevo`);
    await page.fill("input[name=nombre]", nombre);
    await page.fill("input[name=rnc]", rnc);
    await page.click("text=Crear cliente");
    await page.waitForURL(/\/e\/[0-9a-f-]+$/);
    empresas.push(page.url().split("/e/")[1]);
  }
  await br.close();
  execFileSync("node", ["--experimental-strip-types", "--no-warnings", path.join(__dirname, "datos.mjs"), correo, ...empresas], { stdio: "inherit" });
  fs.writeFileSync(path.join(dir, "demo.json"), JSON.stringify({ correo, firma, empresas }, null, 2));
  console.log(correo, firma, empresas.join(" "));
})().catch((e) => { console.error(e); process.exit(1); });
