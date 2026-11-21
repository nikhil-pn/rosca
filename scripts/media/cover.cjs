// Renders the 16:9 cover (media/cover.png) from the live site: the hero, the live glass phone,
// and two glass receipts that tell the story. Run: node scripts/media/cover.cjs [url]
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright-core');
const URL = process.argv[2] || 'https://rosca.exprmnts.fun/';
const OUT = path.join(__dirname, '../../media/cover.png');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--headless=new'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2 });
  await p.goto(URL); await p.waitForTimeout(9000);
  await p.addStyleTag({ content: `
    .nav-wrap, .cta, .lede, .device-note, main > :not(.home-hero), footer, .features, .cta-band { display: none !important; }
    .page { max-width: 1440px; padding: 0 96px; }
    .home-hero { min-height: 900px; padding: 0; column-gap: 40px; grid-template-columns: minmax(0, 1fr) 520px; }
    .home-hero .eyebrow { font-size: 22px; margin-bottom: 22px; }
    .home-hero .hero-title { font-size: 86px; line-height: 0.98; letter-spacing: -0.05em; max-width: 11em; }
    .home-hero .trust { margin-top: 40px; gap: 12px; }
    .home-hero .trust { flex-wrap: nowrap; } .home-hero .trust span { height: 44px; padding: 0 18px; font-size: 17px; white-space: nowrap; }
    .device { transform: scale(0.93); transform-origin: center; }
    .brand-big { display: flex; align-items: center; gap: 12px; font-size: 30px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 44px; }
    .brand-big i { width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center; }
    .receipt { position: absolute; z-index: 5; display: flex; align-items: center; gap: 14px; padding: 16px 22px 16px 16px; border-radius: 22px; font-size: 17px; line-height: 1.3; white-space: nowrap; }
    .receipt b { display: block; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
    .receipt span.s { color: #6b6b70; }
    .receipt .ic { width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; font-size: 20px; font-weight: 700; color: #fff; flex: none; }
    .receipt.ok .ic { background: #22c55e; box-shadow: 0 6px 16px -6px rgba(34,197,94,.7); }
    .receipt.no .ic { background: #ef4444; box-shadow: 0 6px 16px -6px rgba(239,68,68,.7); }
    .r1 { left: -150px; top: 380px; }
    .r2 { right: -70px; top: 610px; }
  ` });
  await p.evaluate(() => {
    const story = document.querySelector('.home-hero > div') || document.querySelector('.home-hero').firstElementChild;
    const brand = document.createElement('div'); brand.className = 'brand-big';
    brand.innerHTML = `<i class="glass"><svg width="24" height="24" viewBox="0 0 24 24"><ellipse cx="12" cy="9" rx="8" ry="3.4" fill="#0b0b0c"/><path d="M4 9v5c0 1.9 3.6 3.4 8 3.4s8-1.5 8-3.4V9c0 1.9-3.6 3.4-8 3.4S4 10.9 4 9z" fill="#0b0b0c"/></svg></i>Rosca`;
    story.prepend(brand);
    const dev = document.querySelector('.device');
    dev.insertAdjacentHTML('beforeend', `
      <div class="receipt glass strong ok r1"><span class="ic">✓</span><div><b>Pot released to the winner</b><span class="s">ML-DSA-87 signature · pqcVerify passed</span></div></div>
      <div class="receipt glass strong no r2"><span class="ic">✕</span><div><b>Stolen-key payout</b><span class="s">Reverted on chain · the pot didn't move</span></div></div>`);
  });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: OUT });
  await b.close();
  console.log('wrote', OUT);
})();
