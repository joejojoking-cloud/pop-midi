import { WorkletSynthesizer, Sequencer } from "spessasynth_lib";

const $ = (id) => document.getElementById(id);
const state = {
  all: [], view: [], shown: 0, pageSize: 60,
  playing: null, synth: null, seq: null, ctx: null, gain: null,
  loadingAudio: null, tick: null, paused: false,
  dragging: false, dragPct: null, seekHold: 0, pendingSeek: null,
};

const fmt = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  if (!s) return "—";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- 音频 ---------- */
async function initAudio() {
  if (state.synth) return;
  if (state.loadingAudio) return state.loadingAudio;
  state.loadingAudio = (async () => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.audioWorklet.addModule("assets/spessasynth_processor.min.js");
    const synth = new WorkletSynthesizer(ctx);
    const pre = ctx.createGain();
    pre.gain.value = 40;
    const gain = ctx.createGain();
    gain.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 0;
    comp.ratio.value = 10;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    synth.connect(pre);
    pre.connect(gain);
    gain.connect(comp);
    comp.connect(ctx.destination);
    const bank = await (await fetch("assets/TimGM6mb.sf2")).arrayBuffer();
    await synth.soundBankManager.addSoundBank(bank, "main");
    await synth.isReady;
    state.ctx = ctx;
    state.synth = synth;
    state.gain = gain;
    state.seq = new Sequencer(synth);
    window.__audio = { ctx, synth, seq: state.seq, gain };
  })();
  return state.loadingAudio;
}

function setSeekUI(t, total) {
  const pct = Math.min(100, Math.max(0, (t / (total || 1)) * 100));
  const el = $("seek");
  el.style.setProperty("--pct", `${pct}%`);
  const held = state.seekHold && performance.now() < state.seekHold;
  if (!state.dragging && !held) el.value = String(Math.round(pct * 10));
  $("time").textContent = `${fmt(t)} / ${fmt(total)}`;
}

function onTick() {
  if (!state.seq || !state.playing) return;
  if (state.seekHold && performance.now() < state.seekHold) return;
  setSeekUI(state.seq.currentTime || 0, state.playing.d || 0);
  if (state.seq.isFinished) stopAll();
}

async function loadAndPlay(x) {
  await initAudio();
  if (state.ctx.state === "suspended") await state.ctx.resume();
  if (state.gain) state.gain.gain.value = Number($("vol")?.value ?? 85) / 100;
  if (state.seq) state.seq.pause();
  const buf = await (await fetch(`midi/${x.f}`)).arrayBuffer();
  state.seq.loadNewSongList([{ binary: buf, fileName: `${x.t}.mid` }]);
  state.seq.play();
  state.paused = false;
  state.playing = x;
  updatePlayer();
  if (!state.tick) state.tick = setInterval(onTick, 250);
}

function stopAll() {
  if (state.seq) state.seq.pause();
  clearInterval(state.tick);
  state.tick = null;
  state.playing = null;
  state.paused = false;
  $("player").hidden = true;
  $("seek").style.setProperty("--pct", "0%");
  $("seek").value = "0";
  document.querySelectorAll(".play.on").forEach((b) => b.classList.remove("on"));
}

function updatePlayer() {
  const x = state.playing;
  if (!x) return;
  $("player").hidden = false;
  $("nowTitle").textContent = `${x.t} · ${x.a}`;
  $("dlNow").href = `midi/${x.f}`;
  $("dlNow").setAttribute("download", `${x.a} - ${x.t}.mid`);
  $("playBtn").textContent = state.paused ? "▶" : "❚❚";
  $("time").textContent = `0:00 / ${fmt(x.d)}`;
}

/* ---------- 列表 ---------- */
function matches(x) {
  const q = $("q").value.trim().toLowerCase();
  if ($("region").value && x.r !== $("region").value) return false;
  if ($("artist").value && x.a !== $("artist").value) return false;
  if (q) {
    const hay = `${x.t} ${x.a}`.toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function apply() {
  state.view = state.all.filter(matches);
  const key = $("sort").value;
  state.view.sort((a, b) =>
    key === "d" ? a.d - b.d :
    key === "a" ? a.a.localeCompare(b.a, "zh") || a.t.localeCompare(b.t, "zh") :
    key === "t" ? a.t.localeCompare(b.t, "zh") :
    b.d - a.d);
  state.shown = 0;
  $("list").innerHTML = "";
  $("count").textContent = `${state.view.length} 首 / 共 ${state.all.length} 首`;
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
  li.innerHTML = `
    <div class="txt">
      <div class="title"></div>
      <div class="sub">${esc(x.a)} · ${esc(x.r)} · ${fmt(x.d)} · ${x.k} KB</div>
    </div>
    <div class="acts">
      <button class="play" data-play="${x.id}" aria-label="播放">▶</button>
      <a class="dl" href="midi/${x.f}" download="${esc(x.a + " - " + x.t)}.mid">下载</a>
    </div>`;
  li.querySelector(".title").textContent = x.t;
  return li;
}

/* ---------- 交互 ---------- */
$("list").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-play]");
  if (!btn) return;
  const x = state.all.find((v) => v.id === btn.dataset.play);
  if (!x) return;
  try {
    if (state.playing && state.playing.id === x.id) {
      if (state.paused) { await state.ctx.resume(); state.seq.play(); state.paused = false; }
      else { state.seq.pause(); state.paused = true; }
      updatePlayer();
      return;
    }
    document.querySelectorAll(".play.on").forEach((b) => b.classList.remove("on"));
    btn.classList.add("on");
    btn.textContent = "…";
    await loadAndPlay(x);
    btn.textContent = "❚❚";
  } catch (err) {
    btn.textContent = "▶";
    $("notice").textContent = `这首没能播放：${err && err.message ? err.message : err}`;
    $("notice").hidden = false;
  }
});

$("playBtn").addEventListener("click", async () => {
  if (!state.seq || !state.playing) return;
  if (state.paused) {
    await state.ctx.resume();
    state.seq.play();
    if (state.pendingSeek != null) {
      const p = state.pendingSeek; state.pendingSeek = null; state.seekHold = 0;
      requestAnimationFrame(() => { state.seq.currentTime = p; });
    }
    state.paused = false;
  } else { state.seq.pause(); state.paused = true; }
  updatePlayer();
});
$("closeBtn").addEventListener("click", stopAll);
$("vol").addEventListener("input", (e) => { if (state.gain) state.gain.gain.value = Number(e.target.value) / 100; });

/* 进度条 */
const seekEl = $("seek");
const seekTotal = () => (state.playing && state.playing.d) || 0;
const pctFromEvent = (e) => {
  const r = seekEl.getBoundingClientRect();
  return Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
};
function previewSeek(pct) {
  const total = seekTotal();
  if (!total) return;
  seekEl.style.setProperty("--pct", `${pct}%`);
  $("time").textContent = `${fmt((pct / 100) * total)} / ${fmt(total)}`;
}
function applySeek(pct) {
  const total = seekTotal();
  if (!state.seq || !state.playing || !total) return;
  const target = Math.min(total - 0.1, Math.max(0, (pct / 100) * total));
  if (state.paused) {
    state.pendingSeek = target;
    state.seekHold = performance.now() + 36e5;
    setSeekUI(target, total);
    return;
  }
  state.seq.currentTime = target;
  state.seekHold = performance.now() + 400;
  setSeekUI(target, total);
}
seekEl.addEventListener("pointerdown", () => {
  if (!state.playing) return;
  state.dragging = true;
  state.dragPct = Number(seekEl.value) / 10;
});
seekEl.addEventListener("input", () => {
  const pct = Number(seekEl.value) / 10;
  state.dragPct = pct;
  if (state.dragging) previewSeek(pct); else applySeek(pct);
});
const finishSeek = () => {
  if (!state.dragging) return;
  state.dragging = false;
  applySeek(state.dragPct ?? Number(seekEl.value) / 10);
};
seekEl.addEventListener("change", finishSeek);
seekEl.addEventListener("pointerup", finishSeek);
document.addEventListener("pointerup", finishSeek, true);
document.addEventListener("mouseup", finishSeek, true);
seekEl.addEventListener("pointercancel", () => { state.dragging = false; });

let timer;
for (const id of ["q", "region", "artist", "sort"]) {
  $(id).addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(apply, id === "q" ? 180 : 0); });
}
new IntersectionObserver((es) => {
  if (es[0].isIntersecting && state.shown < state.view.length) renderMore();
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
