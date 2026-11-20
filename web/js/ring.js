// The circle drawn as it is: the pot in the middle, members around it, coins moving between them.
// Used live in the app (one real round) and as a looping explainer on the How page and in the app.

const html = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * Mount a ring in `el`. Returns { set(state), coin(from, to, n) }.
 * state = { pot: "$30", label: "Round 1 of 3", members: [{ name, me?, paid?, winner?, approved?, bid? }] }
 * coin(): from/to are a member index or "pot".
 */
export function createRing(el) {
  el.classList.add("ring");
  el.innerHTML = `
    <svg class="ring-orbit" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="38" /></svg>
    <div class="ring-pot"><span class="ring-amount num">$0</span><span class="ring-label"></span></div>
    <div class="ring-members"></div>`;
  const pot = el.querySelector(".ring-pot");
  const membersEl = el.querySelector(".ring-members");
  let n = 0;

  const pos = (i) => {
    const a = (-90 + (360 / n) * i) * (Math.PI / 180);
    return { x: 50 + 38 * Math.cos(a), y: 50 + 38 * Math.sin(a) };
  };

  function set(state) {
    el.querySelector(".ring-amount").innerHTML = state.pot;
    el.querySelector(".ring-label").textContent = state.label ?? "";
    pot.classList.toggle("glow", Boolean(state.potGlow));
    if (state.members.length !== n) {
      n = state.members.length;
      membersEl.innerHTML = state.members
        .map((_, i) => {
          const p = pos(i);
          return `<div class="ring-m" style="left:${p.x}%;top:${p.y}%"><span class="ring-av"></span><span class="ring-name"></span><span class="ring-badge"></span></div>`;
        })
        .join("");
    }
    state.members.forEach((m, i) => {
      const node = membersEl.children[i];
      node.className = "ring-m" + (m.me ? " me" : "") + (m.paid ? " paid" : "") + (m.winner ? " winner" : "") + (m.approved ? " approved" : "");
      node.querySelector(".ring-av").textContent = m.me ? "You" : (m.name || "?")[0];
      node.querySelector(".ring-name").innerHTML = html(m.me ? "You" : m.name);
      node.querySelector(".ring-badge").textContent = m.bid ? m.bid : m.winner ? "★" : m.approved ? "✓" : "";
      node.querySelector(".ring-badge").className = "ring-badge" + (m.bid ? " bid" : m.winner ? " star" : m.approved ? " tick" : "");
    });
  }

  /** Fly `count` coins from one place to another. */
  function coin(from, to, count = 1) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const at = (w) => (w === "pot" ? { x: 50, y: 50 } : pos(w));
    const a = at(from);
    const b = at(to);
    for (let k = 0; k < count; k++) {
      const c = document.createElement("span");
      c.className = "ring-coin";
      el.append(c);
      c.animate(
        [
          { left: `${a.x}%`, top: `${a.y}%`, opacity: 0, transform: "translate(-50%,-50%) scale(.6)" },
          { opacity: 1, offset: 0.15 },
          { left: `${b.x}%`, top: `${b.y}%`, opacity: 0.9, transform: "translate(-50%,-50%) scale(1)" },
        ],
        { duration: 750, delay: k * 120, easing: "cubic-bezier(.32,.72,0,1)", fill: "forwards" },
      ).onfinish = () => c.remove();
    }
  }

  return { set, coin };
}

const DEMO = ["Anu", "Biju", "Chitra"];
const STEPS = [
  { t: "Pay", caption: "Everyone pays their $10 share into the pot. Only the contract holds it." },
  { t: "Bid", caption: "Whoever needs money now bids a discount. The highest discount wins, like a real chit auction." },
  { t: "Close", caption: "When bidding ends, anyone closes the auction. Biju wins the pot at a $3 discount." },
  { t: "Approve", caption: "A majority of members approves the payout." },
  { t: "Release", caption: "Biju signs with a post-quantum ML-DSA-87 key. The chain checks it, pays Biju, and shares the $3 discount with everyone." },
];

/** A looping five-step explainer. Optional `dotsEl` gets clickable step pills. */
export function mountFlowDemo(el, captionEl, dotsEl) {
  const ring = createRing(el);
  let step = 0;
  let timer;
  const base = () => DEMO.map((name) => ({ name }));

  function show(i) {
    step = i;
    const m = base();
    let pot = "$0";
    if (i >= 0) {
      m.forEach((x) => (x.paid = true));
      pot = "$30";
    }
    if (i >= 1) m[1].bid = "−$3";
    if (i >= 2) {
      m[1].bid = null;
      m[1].winner = true;
    }
    if (i >= 3) {
      m[0].approved = true;
      m[2].approved = true;
    }
    if (i >= 4) pot = "$0";
    ring.set({ pot, label: ["into the pot", "auction open", "Biju wins", "2 of 3 approve", "paid out"][i], members: m, potGlow: i === 0 });
    if (i === 0) [0, 1, 2].forEach((k) => setTimeout(() => ring.coin(k, "pot"), k * 350));
    if (i === 4) {
      ring.coin("pot", 1, 3);
      setTimeout(() => [0, 1, 2].forEach((k) => ring.coin("pot", k)), 900);
    }
    if (captionEl) captionEl.textContent = STEPS[i].caption;
    if (dotsEl) [...dotsEl.children].forEach((d, k) => d.classList.toggle("on", k === i));
    clearTimeout(timer);
    timer = setTimeout(() => show((step + 1) % STEPS.length), i === 4 ? 4200 : 3400);
  }

  if (dotsEl) {
    dotsEl.innerHTML = STEPS.map((s, i) => `<button type="button" class="flow-dot" data-i="${i}">${i + 1}. ${s.t}</button>`).join("");
    dotsEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (b) show(Number(b.dataset.i));
    });
  }
  show(0);
  return { stop: () => clearTimeout(timer) };
}
