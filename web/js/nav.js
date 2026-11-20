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
