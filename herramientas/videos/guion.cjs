// Utilidades para grabar videos tutoriales: cursor animado, clic con onda, resaltado y subtítulos.
const { chromium } = require(process.env.PLAYWRIGHT);
const B = "http://localhost:3100";
const CAPA = () => {
  if (window.__tuto) return;
  const css = document.createElement("style");
  css.textContent = `
  #tuto-cursor{position:fixed;z-index:2147483647;width:26px;height:26px;pointer-events:none;transition:left .9s cubic-bezier(.4,0,.2,1),top .9s cubic-bezier(.4,0,.2,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))}
  #tuto-onda{position:fixed;z-index:2147483646;width:16px;height:16px;border-radius:50%;border:3px solid #B88A40;pointer-events:none;opacity:0}
  #tuto-onda.si{animation:onda .6s ease-out}
  @keyframes onda{0%{opacity:1;transform:translate(-50%,-50%) scale(.5)}100%{opacity:0;transform:translate(-50%,-50%) scale(4)}}
  #tuto-marco{position:fixed;z-index:2147483645;border:3px solid #B88A40;border-radius:8px;box-shadow:0 0 0 9999px rgba(0,30,12,.18);pointer-events:none;transition:opacity .35s ease;opacity:0}
  #tuto-sub{position:fixed;z-index:2147483647;left:50%;bottom:22px;transform:translateX(-50%);max-width:1000px;background:rgba(0,61,25,.94);color:#F6F3EC;font:600 21px 'Source Sans 3',Arial,sans-serif;padding:12px 22px;border-radius:10px;border-bottom:3px solid #B88A40;text-align:center;opacity:0;transition:opacity .3s}
  #tuto-sub b{color:#e3c27f}
  #tuto-tarjeta{position:fixed;inset:0;z-index:2147483647;background:#003D19;color:#F6F3EC;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Source Sans 3',Arial,sans-serif;opacity:0;transition:opacity .5s;pointer-events:none}
  #tuto-tarjeta h1{font-size:46px;margin:12px 0 6px;color:#F6F3EC}#tuto-tarjeta p{font-size:22px;color:#e3c27f;margin:4px}#tuto-tarjeta .linea{width:120px;height:4px;background:#B88A40;margin:14px}`;
  document.documentElement.appendChild(css);
  const mk = (id, html = "") => { const d = document.createElement("div"); d.id = id; d.innerHTML = html; document.documentElement.appendChild(d); return d; };
  mk("tuto-marco"); mk("tuto-onda"); mk("tuto-sub"); mk("tuto-tarjeta");
  const c = mk("tuto-cursor", '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="#fff" stroke="#003D19" stroke-width="1.6" stroke-linejoin="round"/></svg>');
  const p = JSON.parse(sessionStorage.getItem("tuto-pos") || '{"x":640,"y":360}');
  c.style.left = p.x + "px"; c.style.top = p.y + "px";
  window.__tuto = true;
};
async function abrir(nombreArchivo, dir) {
  const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await br.newContext({ viewport: { width: 1280, height: 720 }, locale: "es-DO", recordVideo: { dir, size: { width: 1280, height: 720 } } });
  await ctx.addInitScript(CAPA);
  const page = await ctx.newPage();
  const espera = (ms) => page.waitForTimeout(ms);
  const t = {
    page, espera,
    async ir(ruta) { await page.goto(B + ruta, { waitUntil: "networkidle" }); await page.evaluate(CAPA); },
    async sub(texto, ms = 2600) {
      await page.evaluate((x) => { const s = document.getElementById("tuto-sub"); s.innerHTML = x; s.style.opacity = x ? 1 : 0; }, texto);
      if (ms) await espera(ms);
    },
    async tarjeta(titulo, linea2 = "", ms = 3200) {
      await page.evaluate(([a, b]) => { const c = document.getElementById("tuto-tarjeta");
        c.innerHTML = `<p style="letter-spacing:3px;font-size:16px">EMPIRE TAX’N LEGAL · SISTEMA CONTABLE</p><div class="linea"></div><h1>${a}</h1><p>${b}</p>`; c.style.opacity = 1; }, [titulo, linea2]);
      await espera(ms);
      await page.evaluate(() => { document.getElementById("tuto-tarjeta").style.opacity = 0; });
      await espera(600);
    },
    async señalar(loc, texto) {
      await loc.scrollIntoViewIfNeeded(); await espera(250);
      const b = await loc.boundingBox();
      await page.evaluate(([b, x]) => {
        const m = document.getElementById("tuto-marco");
        Object.assign(m.style, { left: b.x - 6 + "px", top: b.y - 6 + "px", width: b.width + 12 + "px", height: b.height + 12 + "px", opacity: 1 });
        const c = document.getElementById("tuto-cursor"); const px = b.x + Math.min(b.width / 2, 40), py = b.y + b.height / 2;
        c.style.left = px + "px"; c.style.top = py + "px"; sessionStorage.setItem("tuto-pos", JSON.stringify({ x: px, y: py }));
        if (x) { const s = document.getElementById("tuto-sub"); s.innerHTML = x; s.style.opacity = 1; }
      }, [b, texto || ""]);
      await espera(1300);
    },
    async soltar() { await page.evaluate(() => { document.getElementById("tuto-marco").style.opacity = 0; }); },
    async onda() {
      await page.evaluate(() => { const c = document.getElementById("tuto-cursor"), o = document.getElementById("tuto-onda");
        o.style.left = c.style.left; o.style.top = c.style.top; o.classList.remove("si"); void o.offsetWidth; o.classList.add("si"); });
      await espera(450);
    },
    async clic(loc, texto, despues = 900) { await t.señalar(loc, texto); await t.onda(); await t.soltar(); await loc.click(); await page.waitForLoadState("networkidle"); await page.evaluate(CAPA); await espera(despues); },
    async escribir(loc, valor, texto) { await t.señalar(loc, texto); await t.onda(); await loc.click(); await loc.fill(""); await loc.pressSequentially(valor, { delay: 85 }); await espera(500); await t.soltar(); },
    async elegir(loc, opcion, texto) { await t.señalar(loc, texto); await t.onda(); await loc.selectOption(opcion); await espera(900); await t.soltar(); },
    async entrar(email) {
      await t.ir("/entrar");
      await page.fill("input[name=email]", email); await page.fill("input[name=clave]", "clave-segura-123");
      await page.getByRole("button", { name: /entrar/i }).click(); await page.waitForURL(/empresas/); await page.waitForLoadState("networkidle"); await page.evaluate(CAPA);
    },
    async cerrar(destino) {
      const v = page.video(); await page.close(); await v.saveAs(destino); await ctx.close(); await br.close();
    },
  };
  return t;
}
module.exports = { abrir };
