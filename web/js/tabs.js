// The phone's bottom bar: Wallet, Activity and Members.
export function initTabs(onShow) {
  const views = [...document.querySelectorAll(".phone .view")];
  const btns = [...document.querySelectorAll(".dock-btn[data-tab]")];
  const wallet = views.find((v) => v.dataset.view === "wallet");
  for (const b of btns) {
    b.addEventListener("click", () => {
      const tab = b.dataset.tab;
      const h = wallet.hidden ? null : wallet.offsetHeight; // keep the phone the same height
      for (const v of views) {
        v.hidden = v.dataset.view !== tab;
        if (h && v !== wallet) v.style.height = `${h}px`;
      }
      for (const x of btns) x.classList.toggle("active", x === b);
      onShow(tab);
    });
  }
}

/** Members of the selected circle: paid this round, won already. */
export function renderPeople(list) {
  const ul = document.getElementById("people");
  ul.replaceChildren(
    ...list.map((p) => {
      const li = document.createElement("li");
      const av = document.createElement("span");
      av.className = "pav";
      av.textContent = p.name[0];
      const nm = document.createElement("span");
      nm.className = "pname";
      nm.textContent = p.name;
      const small = document.createElement("small");
      small.textContent = p.won ? "has taken the pot" : "waiting for their turn";
      nm.append(small);
      const tag = document.createElement("span");
      tag.className = "tag" + (p.paid ? " green" : "");
      tag.textContent = p.paid ? "paid" : "not yet";
      li.append(av, nm, tag);
      return li;
    }),
  );
}
