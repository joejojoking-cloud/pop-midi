const $ = (id) => document.getElementById(id);
const state = { all: [], view: [], shown: 0, pageSize: 60 };

const fmt = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  if (!s) return "—";
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function matches(x) {
  const q = $("q").value.trim().toLowerCase();
  const region = $("region").value;
  const artist = $("artist").value;
  const dur = $("dur").value;
  if (region && x.r !== region) return false;
  if (artist && x.a !== artist) return false;
  if (dur) {
    const [lo, hi] = dur.split("-").map(Number);
    if (x.d < lo || x.d >= hi) return false;
  }
  if (q) {
    const hay = `${x.t} ${x.a}`.toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function apply() {
  state.view = state.all.filter(matches);
  const key = $("sort").value;
  state.view.sort((a, b) => {
    if (key === "dl") return b.dl - a.dl;
    if (key === "d") return a.d - b.d;
    if (key === "a") return a.a.localeCompare(b.a, "zh") || a.t.localeCompare(b.t, "zh");
    return a.t.localeCompare(b.t, "zh");
  });
  state.shown = 0;
  $("list").innerHTML = "";
  $("count").textContent = `${state.view.length} 首 / 共 ${state.all.length} 条`;
  $("empty").hidden = state.view.length > 0;
  renderMore();
}

function renderMore() {
  const frag = document.createDocumentFragment();
  const end = Math.min(state.shown + state.pageSize, state.view.length);
  for (let i = state.shown; i < end; i++) frag.appendChild(rowFor(state.view[i]));
  state.shown = end;
  $("list").appendChild(frag);
}

function rowFor(x) {
  const li = document.createElement("li");
  li.className = "row";
  const hot = x.dl >= 500 ? `<span class="hot">${x.dl} 次下载</span>` : "";
  li.innerHTML = `
    <div>
      <div class="title"></div>
      <div class="sub">${esc(x.a)} · ${x.r} · ${fmt(x.d)} · ${x.k ? x.k + " KB" : "—"}${x.g ? " · ★" + x.g : ""}${hot}</div>
    </div>
    <a class="dl" href="${esc(x.u)}" target="_blank" rel="noopener">去下载 →</a>`;
  li.querySelector(".title").textContent = x.t;
  return li;
}

let timer;
for (const id of ["q", "region", "artist", "dur", "sort"]) {
  $(id).addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(apply, id === "q" ? 180 : 0);
  });
}

new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && state.shown < state.view.length) renderMore();
}, { rootMargin: "600px" }).observe($("sentinel"));

(async function boot() {
  try {
    const data = await (await fetch("data.json", { cache: "no-cache" })).json();
    state.all = data;
    const artists = [...new Set(data.map((d) => d.a))].sort((a, b) => a.localeCompare(b, "zh"));
    for (const a of artists) {
      const o = document.createElement("option");
      o.value = a;
      o.textContent = `${a}（${data.filter((d) => d.a === a).length}）`;
      $("artist").appendChild(o);
    }
    apply();
  } catch (err) {
    $("count").textContent = "数据加载失败";
  }
})();
