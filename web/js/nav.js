// The glass nav's menu on small screens.
const btn = document.querySelector(".nav-menu");
const sheet = document.getElementById("nav-sheet");
btn?.addEventListener("click", () => {
  const open = sheet.hidden;
  sheet.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && sheet && !sheet.hidden) {
    sheet.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }
});

// Desktop home: shrink the phone so the whole hero fits the window, never larger than life.
const phone = document.querySelector(".home-hero .phone");
function fitPhone() {
  if (!phone) return;
  phone.style.zoom = "";
  if (innerWidth <= 900) return;
  const natural = phone.offsetHeight + 40; // phone plus the note under it
  const room = innerHeight - 110; // nav and breathing space
  phone.style.zoom = String(Math.max(0.55, Math.min(1, room / natural)).toFixed(3));
}
fitPhone();
addEventListener("resize", fitPhone);

// ---------------------------------------------------------------- "Watch demo": the demo video in a glass window
// Paste the YouTube link here when it's published (watch?v=…, youtu.be/… or a /shorts/ link all work).
const VIDEO_URL = "";

function youtubeId(url) {
  const m = String(url).match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function openVideo() {
  const id = youtubeId(VIDEO_URL);
  const wrap = document.createElement("div");
  wrap.className = "video-root";
  wrap.innerHTML = `
    <div class="video-backdrop"></div>
    <div class="video-box glass strong" role="dialog" aria-modal="true" aria-label="Rosca demo video">
      <button class="video-x" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <div class="video-frame">${
        id
          ? `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0" title="Rosca demo" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
          : `<div class="video-soon"><span class="video-play"><svg width="28" height="28" viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg></span><p>The demo video is coming soon.</p><a class="btn-glass" href="https://app.rosca.exprmnts.fun/?mode=demo">Try the demo in the app</a></div>`
      }</div>
    </div>`;
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add("open"));
  const close = () => {
    wrap.classList.remove("open");
    setTimeout(() => wrap.remove(), 250);
    removeEventListener("keydown", onKey);
  };
  const onKey = (e) => e.key === "Escape" && close();
  addEventListener("keydown", onKey);
  wrap.querySelector(".video-backdrop").addEventListener("click", close);
  wrap.querySelector(".video-x").addEventListener("click", close);
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-video]")) openVideo();
});
