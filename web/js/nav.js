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
