  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const MAX_LV = 3;

  const ICON_SPEAK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>';
  const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

  let words = [];
  const ui = { view: "list", sheet: false, q: "", tag: "", studyDir: "en", studySet: "todo", quizDir: "en" };
  try { Object.assign(ui, JSON.parse(localStorage.getItem("wordring.ui") || "{}"), { q: "" }); } catch {}
  const saveUi = () => { try { localStorage.setItem("wordring.ui", JSON.stringify(ui)); } catch {} };

  // ---------- storage: Firestore when signed in, else this browser ----------
  // Firestore layout: users/{uid}/words/{wordId}, plus users/{uid}/words/_plan for the round plan.
  const LOCAL_KEY = "wordring.words", PLAN_KEY = "wordring.plan", PLAN_ID = "_plan";
  let plan = null; // { days, start, round, todayDate, todayQuota }
  let fb = null;   // { auth, db, mod: firebase functions } once Firebase is configured
  let unsub = null;
  const store = {
    mode: "loading", uid: null,
    ref(id) { return fb.mod.doc(fb.db, "users", this.uid, "words", id); },
    // Firestore writes are applied locally at once and synced in the background,
    // so we don't wait for the server (that would hang while offline).
    cloud(p) { p.catch(e => toast(e?.code === "permission-denied" ? "保存する権限がありません。ログインし直してください" : "同期に失敗しました。通信状況を確認してください")); },
    async putPlan(p) {
      plan = p;
      if (this.mode === "db") { this.cloud(fb.mod.setDoc(this.ref(PLAN_ID), p)); return; }
      try { localStorage.setItem(PLAN_KEY, JSON.stringify(p)); } catch {}
      render();
    },
    async put(w) {
      const { id, ...body } = w;
      if (this.mode === "db") { this.cloud(fb.mod.setDoc(this.ref(id), body)); return; }
      const i = words.findIndex(x => x.id === id);
      if (i >= 0) words[i] = w; else words.push(w);
      this.saveLocal(); render();
    },
    async del(id) {
      if (this.mode === "db") { this.cloud(fb.mod.deleteDoc(this.ref(id))); return; }
      words = words.filter(x => x.id !== id); this.saveLocal(); render();
    },
    saveLocal() { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(words)); } catch {} },
    readLocal() {
      let w = [], p = null;
      try { w = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); } catch {}
      try { p = JSON.parse(localStorage.getItem(PLAN_KEY) || "null"); } catch {}
      return { w, p };
    },
    clearLocal() { try { localStorage.removeItem(LOCAL_KEY); localStorage.removeItem(PLAN_KEY); } catch {} },
  };

  function setSync(on, text) {
    const el = $("#sync"); el.classList.toggle("on", on); el.querySelector("span").textContent = text;
  }
  function renderAccount(user) {
    const host = $("#account");
    if (!fb) { host.innerHTML = ""; return; }
    host.innerHTML = user
      ? `<button class="link" id="sign-out" title="${esc(user.email || "")}">ログアウト</button>`
      : `<button class="btn primary sm" id="sign-in">Googleでログイン</button>`;
    $("#sign-in")?.addEventListener("click", signIn);
    $("#sign-out")?.addEventListener("click", () => fb.mod.signOut(fb.auth));
  }
  function useLocal() {
    unsub?.(); unsub = null;
    store.mode = "local"; store.uid = null;
    ({ w: words, p: plan } = store.readLocal());
    setSync(false, fb ? "この端末だけに保存中" : "この端末に保存");
    render();
  }
  function useCloud(uid) {
    unsub?.();
    store.mode = "db"; store.uid = uid;
    words = []; plan = null; firstData = true;
    setSync(true, "PC・スマホで同期");
    const col = fb.mod.collection(fb.db, "users", uid, "words");
    unsub = fb.mod.onSnapshot(col, snap => {
      const p = snap.docs.find(d => d.id === PLAN_ID);
      plan = p ? { ...p.data() } : null;
      words = snap.docs.filter(d => d.id !== PLAN_ID).map(d => ({ id: d.id, ...d.data() }));
      render();
    }, () => setSync(false, "同期できません。再読み込みしてください"));
    offerMigration();
  }

  async function signIn() {
    const provider = new fb.mod.GoogleAuthProvider();
    try { await fb.mod.signInWithPopup(fb.auth, provider); }
    catch (e) {
      if (e?.code === "auth/popup-closed-by-user" || e?.code === "auth/cancelled-popup-request") return;
      if (e?.code === "auth/popup-blocked" || e?.code === "auth/operation-not-supported-in-this-environment") {
        return fb.mod.signInWithRedirect(fb.auth, provider).catch(() => toast("ログインできませんでした"));
      }
      toast(e?.code === "auth/unauthorized-domain" ? "このURLはFirebaseの承認済みドメインに入っていません" : "ログインできませんでした");
    }
  }

  // Words saved on this device before signing in can be moved into the account once.
  function offerMigration() {
    const { w, p } = store.readLocal();
    if (!w.length) return;
    $("#dlg-host").innerHTML = `<div class="overlay" id="ov"><div class="dlg">
      <h3>この端末の単語をアカウントに移しますか？</h3>
      <p class="msg" style="margin:0">ログイン前にこの端末で登録した ${w.length} 語があります。移すと、ほかの端末でも使えるようになります。</p>
      <div class="actions"><button class="btn primary" id="mg-yes">${w.length} 語を移す</button><button class="btn ghost" id="mg-no">移さない</button></div>
    </div></div>`;
    $("#mg-no").onclick = () => { store.clearLocal(); closeDlg(); };
    $("#mg-yes").onclick = async () => {
      const { writeBatch } = fb.mod;
      for (let i = 0; i < w.length; i += 400) {
        const b = writeBatch(fb.db);
        w.slice(i, i + 400).forEach(({ id, ...body }) => b.set(store.ref(id), body));
        if (i === 0 && p && !plan) b.set(store.ref(PLAN_ID), p);
        store.cloud(b.commit());
      }
      store.clearLocal(); closeDlg(); toast(`${w.length} 語を移しました`);
    };
  }

  async function init() {
    render();
    let config = null;
    try { ({ firebaseConfig: config } = await import("./firebase-config.js")); } catch {}
    if (!config?.apiKey || config.apiKey.startsWith("YOUR_")) return useLocal();
    try {
      const V = "10.12.2", base = `https://www.gstatic.com/firebasejs/${V}/`;
      const [app, auth, fs] = await Promise.all([import(base + "firebase-app.js"), import(base + "firebase-auth.js"), import(base + "firebase-firestore.js")]);
      const fapp = app.initializeApp(config);
      const db = fs.initializeFirestore(fapp, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
      fb = { auth: auth.getAuth(fapp), db, mod: { ...auth, ...fs } };
      auth.getRedirectResult(fb.auth).catch(() => {});
      auth.onAuthStateChanged(fb.auth, user => {
        renderAccount(user);
        if (user) useCloud(user.uid); else useLocal();
      });
    } catch {
      useLocal();
      setSync(false, "オフライン・この端末に保存");
    }
  }

  // ---------- helpers ----------
  function toast(t) {
    const el = $("#toast"); el.textContent = t; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2000);
  }
  function speak(text) {
    try {
      const u = new SpeechSynthesisUtterance(text); u.lang = "en-US"; u.rate = .9;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch { toast("この環境では読み上げできません"); }
  }
  const lvDots = lv => `<span class="lv" title="習熟度 ${lv}/${MAX_LV}">${[1,2,3].map(i => `<i class="${i <= lv ? "on" : ""}"></i>`).join("")}</span>`;
  async function save(w) {
    try { await store.put(w); }
    catch (e) { toast(e?.code === "quota_exceeded" ? "保存できる上限に達しました。不要な単語を削除してください" : "保存できませんでした。もう一度試してください"); throw e; }
  }

  // ---------- plan: finish one round in N days ----------
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const toUTC = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const dayDiff = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
  const addDays = (s, n) => { const d = new Date(toUTC(s) + n * 86400000); return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`; };
  const seenInRound = w => plan && w.seenRound === plan.round;
  const seenToday = w => seenInRound(w) && w.seenDate === todayStr();

  function quotaFor(p, base) {
    const daysLeft = Math.max(1, p.days - dayDiff(p.start, todayStr()));
    return Math.ceil(base / daysLeft);
  }
  function planInfo() {
    const total = words.length;
    const done = words.filter(seenInRound).length;
    const doneToday = words.filter(seenToday).length;
    const left = total - done;
    const elapsed = dayDiff(plan.start, todayStr());
    const daysLeft = plan.days - elapsed;
    const quota = plan.todayDate === todayStr() ? plan.todayQuota : quotaFor(plan, left + doneToday);
    return { total, done, doneToday, left, daysLeft, overdue: daysLeft <= 0, quota, end: addDays(plan.start, plan.days - 1), todayLeft: Math.max(0, quota - doneToday) };
  }
  let ensuring = false;
  function ensureToday() {
    if (store.mode === "loading" || !plan || plan.todayDate === todayStr() || ensuring) return;
    ensuring = true;
    const left = words.filter(w => !seenInRound(w)).length;
    store.putPlan({ ...plan, todayDate: todayStr(), todayQuota: quotaFor(plan, left) }).catch(() => {}).finally(() => ensuring = false);
  }
  function markSeen(w) {
    return plan && w.seenRound !== plan.round ? { ...w, seenRound: plan.round, seenDate: todayStr() } : w;
  }

  let planEdit = false, draftDays = null;
  function renderPlan() {
    const host = $("#plan-host");
    if (store.mode === "loading" || !words.length) { host.innerHTML = ""; return; }
    if (!plan || planEdit) {
      const left = plan ? words.filter(w => !seenInRound(w)).length : words.length;
      const d = Math.max(1, Math.min(365, parseInt(draftDays ?? plan?.days ?? 14, 10) || 1));
      const per = Math.ceil(left / d);
      host.innerHTML = `<form class="plan setup" id="plan-form">
        <div class="section-h">${plan ? "残り何日で一周する？" : "何日で一周する？"}</div>
        <div class="days-row">
          <input type="number" id="plan-days" min="1" max="365" value="${d}" inputmode="numeric" aria-label="日数"> <span>日</span>
          ${[3, 7, 14, 30].map(n => `<button type="button" class="preset" data-d="${n}" aria-pressed="${n === d}">${n}日</button>`).join("")}
        </div>
        <div class="calc">${plan ? "残り" : "全"} <b>${left}</b> 語 ÷ <b>${d}</b> 日 → 1日 <b>${per}</b> 語　<span class="msg">${addDays(todayStr(), d - 1)}に一周</span></div>
        <div class="actions"><button class="btn primary" type="submit">${plan ? "この日数で計算し直す" : "この計画で始める"}</button>
          ${plan ? `<button class="btn ghost" type="button" id="plan-cancel">キャンセル</button>` : ""}</div>
        <div class="msg">単語を後から追加しても、次の日から自動で割り振り直します。</div>
      </form>`;
      const setDays = v => { draftDays = v; renderPlan(); const i = $("#plan-days"); i.focus(); i.setSelectionRange?.(9, 9); };
      $("#plan-days").oninput = e => { draftDays = e.target.value; const v = Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1)); $(".calc", host).innerHTML = `${plan ? "残り" : "全"} <b>${left}</b> 語 ÷ <b>${v}</b> 日 → 1日 <b>${Math.ceil(left / v)}</b> 語　<span class="msg">${addDays(todayStr(), v - 1)}に一周</span>`; host.querySelectorAll(".preset").forEach(b => b.setAttribute("aria-pressed", +b.dataset.d === v)); };
      host.querySelectorAll(".preset").forEach(b => b.onclick = () => setDays(b.dataset.d));
      $("#plan-cancel")?.addEventListener("click", () => { planEdit = false; draftDays = null; renderPlan(); });
      $("#plan-form").onsubmit = async e => {
        e.preventDefault();
        const days = Math.max(1, Math.min(365, parseInt($("#plan-days").value, 10) || 1));
        const doneToday = plan ? words.filter(seenToday).length : 0;
        const p = { days, start: todayStr(), round: plan?.round || 1, todayDate: todayStr() };
        p.todayQuota = quotaFor(p, left + doneToday) ;
        planEdit = false; draftDays = null;
        try { await store.putPlan(p); } catch { toast("保存できませんでした"); return; }
        toast(`1日 ${p.todayQuota} 語で計画しました`); render();
      };
      return;
    }
    const s = planInfo();
    if (s.left === 0) {
      host.innerHTML = `<div class="plan"><div class="eyebrow"><span>第${plan.round}周</span></div>
        <div class="goal"><b>完了</b><span>${s.total} 語をすべて一周しました</span></div>
        <div class="actions"><button class="btn" id="plan-next">第${plan.round + 1}周を始める（${plan.days}日）</button><button class="btn ghost" id="plan-edit">日数を変える</button></div></div>`;
      $("#plan-next").onclick = async () => {
        const p = { days: plan.days, start: todayStr(), round: plan.round + 1, todayDate: todayStr() };
        p.todayQuota = quotaFor(p, words.length);
        try { await store.putPlan(p); } catch { toast("保存できませんでした"); return; }
        render();
      };
      $("#plan-edit").onclick = () => { planEdit = true; renderPlan(); };
      return;
    }
    const pct = s.quota ? Math.min(100, Math.round(s.doneToday / s.quota * 100)) : 100;
    const met = s.doneToday >= s.quota;
    host.innerHTML = `<div class="plan">
      <div class="eyebrow"><span>第${plan.round}周 · ${s.overdue ? "期限を過ぎています" : `${s.end}まで あと${s.daysLeft}日`}</span><span>この周 ${s.done} / ${s.total} 語</span></div>
      <div class="goal"><b>${Math.min(s.doneToday, s.quota)}<span style="font-size:22px;opacity:.6"> / ${s.quota}</span></b><span>${met ? "今日の分は完了" : `今日の単語 あと ${s.todayLeft} 語`}</span></div>
      <div class="meter"><div style="width:${pct}%"></div></div>
      ${s.overdue ? `<div class="sub">残り ${s.left} 語を終えると一周です。日数を変えて計画し直すこともできます。</div>`
        : met ? `<div class="sub">先に進めておくと、明日からの1日の数が減ります。</div>` : ""}
      <div class="actions"><button class="btn" id="plan-go">${met ? "明日の分も進める" : "今日の分を始める"}</button><button class="btn ghost" id="plan-edit">日数を変える</button></div>
    </div>`;
    $("#plan-go").onclick = () => { ui.view = "study"; ui.studySet = "today"; saveUi(); render(); startStudy(met); };
    $("#plan-edit").onclick = () => { planEdit = true; renderPlan(); };
  }

  // ---------- tabs ----------
  document.querySelectorAll("nav.tabs button").forEach(b => b.onclick = () => { ui.view = b.dataset.view; saveUi(); render(); if (ui.view === "study") startStudy(); if (ui.view === "quiz") startQuiz(); });

  // ---------- add form ----------
  $("#toggle-more").onclick = () => { const m = $("#more-fields"); m.hidden = !m.hidden; $("#toggle-more").textContent = m.hidden ? "例文・タグも入力" : "例文・タグを閉じる"; };
  $("#add-form").addEventListener("submit", async e => {
    e.preventDefault();
    const en = $("#in-en").value.trim(), ja = $("#in-ja").value.trim();
    if (!en || !ja) { $("#add-msg").className = "msg err"; $("#add-msg").textContent = "英単語と意味の両方を入力してください"; return; }
    if (store.mode === "loading") return;
    const dup = words.find(w => w.en.toLowerCase() === en.toLowerCase());
    const w = { id: newId(), en, ja, ex: $("#in-ex").value.trim(), tag: $("#in-tag").value.trim(), level: 0, created: Date.now() };
    try { await save(w); } catch { return; }
    $("#add-msg").className = "msg";
    $("#add-msg").textContent = dup ? `「${en}」を追加しました（同じ単語がすでにあります）` : `「${en}」を追加しました`;
    $("#in-en").value = ""; $("#in-ja").value = ""; $("#in-ex").value = "";
    $("#in-en").focus();
  });

  // ---------- list ----------
  $("#q").oninput = e => { ui.q = e.target.value; renderList(); };
  $("#f-tag").onchange = e => { ui.tag = e.target.value; saveUi(); renderList(); };
  $("#sheet-btn").onclick = () => { ui.sheet = !ui.sheet; saveUi(); renderList(); };

  function filtered() {
    const q = ui.q.trim().toLowerCase();
    return words
      .filter(w => !ui.tag || w.tag === ui.tag)
      .filter(w => !q || w.en.toLowerCase().includes(q) || w.ja.toLowerCase().includes(q))
      .sort((a, b) => (b.created || 0) - (a.created || 0));
  }

  function renderStats() {
    const total = words.length, done = words.filter(w => (w.level || 0) >= MAX_LV).length;
    const pct = total ? Math.round(done / total * 100) : 0;
    $("#st-total").textContent = total; $("#st-done").textContent = done; $("#st-pct").textContent = pct + "%";
    $("#st-bar").style.width = pct + "%";
    const tags = [...new Set(words.map(w => w.tag).filter(Boolean))].sort();
    if (ui.tag && !tags.includes(ui.tag)) ui.tag = "";
    $("#f-tag").innerHTML = `<option value="">すべてのタグ</option>` + tags.map(t => `<option ${t === ui.tag ? "selected" : ""}>${esc(t)}</option>`).join("");
    $("#f-tag").hidden = !tags.length;
  }

  function renderList() {
    $("#sheet-btn").setAttribute("aria-pressed", ui.sheet);
    const host = $("#list-host");
    if (store.mode === "loading") { host.innerHTML = `<div class="empty"><p>単語帳を読み込んでいます…</p></div>`; return; }
    if (!words.length) {
      host.innerHTML = `<div class="empty"><strong>まだ単語がありません</strong>
        <p>上のフォームに英単語と意味を入れて「追加する」を押すと、ここにカードが並びます。まず試したいときはサンプルを入れてみてください。</p>
        <button class="btn" id="add-sample">サンプル単語を5つ追加</button></div>`;
      $("#add-sample").onclick = addSamples; return;
    }
    const list = filtered();
    if (!list.length) { host.innerHTML = `<div class="empty"><p>「${esc(ui.q)}」に一致する単語はありません。</p></div>`; return; }
    host.innerHTML = `<ul class="words ${ui.sheet ? "sheet-on" : ""}">` + list.map(w => `
      <li data-id="${w.id}">
        <div class="w-en">${esc(w.en)}${w.tag ? ` <span class="tag">${esc(w.tag)}</span>` : ""}</div>
        <div class="w-meta">${lvDots(w.level || 0)}
          <button class="icon-btn" data-act="speak" aria-label="${esc(w.en)} を読み上げ">${ICON_SPEAK}</button>
          <button class="icon-btn" data-act="edit" aria-label="${esc(w.en)} を編集">${ICON_EDIT}</button></div>
        <div class="w-ja" data-act="peek">${esc(w.ja)}</div>
        ${w.ex ? `<div class="w-ex">${esc(w.ex)}</div>` : ""}
      </li>`).join("") + `</ul>`;
    host.querySelector("ul").onclick = e => {
      const t = e.target.closest("[data-act]"); if (!t) return;
      const w = words.find(x => x.id === t.closest("li").dataset.id); if (!w) return;
      if (t.dataset.act === "speak") speak(w.en);
      if (t.dataset.act === "edit") openEdit(w);
      if (t.dataset.act === "peek" && ui.sheet) t.classList.toggle("peek");
    };
  }

  async function addSamples() {
    const s = [
      ["resilient", "回復力のある、立ち直りが早い", "Children are often more resilient than adults."],
      ["inevitable", "避けられない", "Change is inevitable."],
      ["meticulous", "細心の注意を払った", "She keeps meticulous notes."],
      ["abundant", "豊富な", "The region has abundant water."],
      ["reluctant", "気が進まない", "He was reluctant to leave."],
    ];
    const now = Date.now();
    for (let i = 0; i < s.length; i++) {
      try { await save({ id: newId(), en: s[i][0], ja: s[i][1], ex: s[i][2], tag: "サンプル", level: 0, created: now - i }); } catch { return; }
    }
    toast("サンプルを追加しました");
  }

  // ---------- dialogs ----------
  function closeDlg() { $("#dlg-host").innerHTML = ""; }
  function openEdit(w) {
    $("#dlg-host").innerHTML = `<div class="overlay" id="ov"><form class="dlg" id="ed" autocomplete="off">
      <h3>単語を編集</h3>
      <label class="f">英単語<input type="text" class="en" id="ed-en" value="${esc(w.en)}" required></label>
      <label class="f">意味<input type="text" id="ed-ja" value="${esc(w.ja)}" required></label>
      <label class="f">例文<input type="text" id="ed-ex" value="${esc(w.ex)}"></label>
      <label class="f">タグ<input type="text" id="ed-tag" value="${esc(w.tag)}"></label>
      <div class="actions">
        <button class="btn primary" type="submit">保存</button>
        <button class="btn ghost" type="button" id="ed-cancel">キャンセル</button>
        <span style="flex:1"></span>
        <button class="btn" type="button" id="ed-reset">習熟度をリセット</button>
        <button class="btn danger" type="button" id="ed-del">削除</button>
      </div></form></div>`;
    $("#ov").onclick = e => { if (e.target.id === "ov") closeDlg(); };
    $("#ed-cancel").onclick = closeDlg;
    $("#ed-reset").onclick = async () => { try { await save({ ...w, level: 0 }); } catch { return; } closeDlg(); toast("習熟度をリセットしました"); };
    $("#ed-del").onclick = async e => {
      const b = e.currentTarget;
      if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "本当に削除する"; return; }
      try { await store.del(w.id); } catch { toast("削除できませんでした"); return; }
      closeDlg(); toast(`「${w.en}」を削除しました`);
    };
    $("#ed").onsubmit = async e => {
      e.preventDefault();
      const en = $("#ed-en").value.trim(), ja = $("#ed-ja").value.trim(); if (!en || !ja) return;
      try { await save({ ...w, en, ja, ex: $("#ed-ex").value.trim(), tag: $("#ed-tag").value.trim() }); } catch { return; }
      closeDlg(); toast("保存しました");
    };
  }

  $("#open-import").onclick = () => {
    $("#dlg-host").innerHTML = `<div class="overlay" id="ov"><form class="dlg" id="im">
      <h3>まとめて追加</h3>
      <p class="msg" style="margin:0">1行に1単語。英単語と意味を「,」かタブで区切ります。3つ目に例文も書けます。Excel やスプレッドシートからそのまま貼り付けられます。</p>
      <label class="f">単語リスト<textarea id="im-text" placeholder="apple, りんご&#10;borrow, 借りる, Can I borrow your pen?&#10;curious, 好奇心の強い"></textarea></label>
      <label class="f">タグ（任意・全部に付きます）<input type="text" id="im-tag" placeholder="例: 第5章"></label>
      <div class="actions"><button class="btn primary" type="submit">追加する</button><button class="btn ghost" type="button" id="im-cancel">キャンセル</button></div>
      <div class="msg" id="im-msg"></div></form></div>`;
    $("#ov").onclick = e => { if (e.target.id === "ov") closeDlg(); };
    $("#im-cancel").onclick = closeDlg;
    $("#im").onsubmit = async e => {
      e.preventDefault();
      const tag = $("#im-tag").value.trim();
      const rows = $("#im-text").value.split(/\r?\n/).map(l => l.split(/\t|,|，/).map(s => s.trim())).filter(r => r[0] && r[1]);
      if (!rows.length) { $("#im-msg").className = "msg err"; $("#im-msg").textContent = "「英単語, 意味」の形の行が見つかりません"; return; }
      const btn = e.submitter || $("#im button[type=submit]"); btn.disabled = true;
      const now = Date.now();
      for (let i = 0; i < rows.length; i++) {
        $("#im-msg").textContent = `${i + 1} / ${rows.length} 件を追加中…`;
        try { await save({ id: newId(), en: rows[i][0], ja: rows[i][1], ex: rows[i].slice(2).join(", "), tag, level: 0, created: now - i }); }
        catch { btn.disabled = false; return; }
      }
      closeDlg(); toast(`${rows.length} 件を追加しました`);
    };
  };

  // ---------- flashcards ----------
  let study = { queue: [], i: 0, flipped: false, known: 0 };
  function segBind(id, key, after) {
    const el = $("#" + id);
    el.onclick = e => { const b = e.target.closest("button"); if (!b) return; ui[key] = b.dataset.v; saveUi(); syncSegs(); after(); };
  }
  function syncSegs() {
    [["study-dir", "studyDir"], ["study-set", "studySet"], ["quiz-dir", "quizDir"]].forEach(([id, k]) =>
      $("#" + id).querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === ui[k])));
  }
  segBind("study-dir", "studyDir", () => { study.flipped = false; renderStudy(); });
  segBind("study-set", "studySet", startStudy);
  segBind("quiz-dir", "quizDir", startQuiz);

  function startStudy(extra = false) {
    let pool;
    if (ui.studySet === "today") {
      const s = plan ? planInfo() : null;
      const n = !s ? 0 : extra === true ? s.quota : s.todayLeft;
      pool = shuffle(words.filter(w => !seenInRound(w))).slice(0, n);
    } else {
      pool = shuffle(ui.studySet === "todo" ? words.filter(w => (w.level || 0) < MAX_LV) : words);
    }
    study = { queue: pool.map(w => w.id), i: 0, flipped: false, known: 0 };
    renderStudy();
  }
  function goPlan() { ui.view = "list"; saveUi(); render(); $("#plan-host").scrollIntoView({ block: "start" }); }
  function renderStudyPlan() {
    const el = $("#study-plan");
    if (!plan || !words.length || store.mode === "loading") { el.hidden = true; return; }
    const s = planInfo(); el.hidden = false;
    el.textContent = s.left === 0 ? `第${plan.round}周 完了` : `今日 ${Math.min(s.doneToday, s.quota)} / ${s.quota} 語 · 第${plan.round}周 残り ${s.left} 語`;
  }
  function renderStudy() {
    const host = $("#study-host");
    renderStudyPlan();
    if (store.mode === "loading") { host.innerHTML = `<div class="empty"><p>読み込み中…</p></div>`; return; }
    if (!words.length) { host.innerHTML = `<div class="empty"><strong>カードがまだありません</strong><p>「単語」タブで単語を追加すると、ここで暗記カードとして練習できます。</p></div>`; return; }
    if (ui.studySet === "today" && !plan) {
      host.innerHTML = `<div class="empty"><strong>まだ計画がありません</strong><p>何日で一周するかを決めると、1日にやる単語の数を計算します。</p><button class="btn primary" id="to-plan">日数を決める</button></div>`;
      $("#to-plan").onclick = goPlan; return;
    }
    if (ui.studySet === "today" && (!study.queue.length || study.i >= study.queue.length)) {
      const s = planInfo();
      if (s.left === 0) {
        host.innerHTML = `<div class="empty"><strong>第${plan.round}周 完了</strong><p>${s.total} 語をすべて一周しました。次の周は「単語」タブから始められます。</p><button class="btn primary" id="to-plan">次の周へ</button></div>`;
        $("#to-plan").onclick = goPlan; return;
      }
      if (s.todayLeft === 0) {
        host.innerHTML = `<div class="empty"><strong>今日の ${s.quota} 語 完了</strong><p>${study.queue.length ? `覚えた ${study.known} 枚 / まだ ${study.queue.length - study.known} 枚。` : ""}この周は残り ${s.left} 語です。先に進めておくと、明日からの1日の数が減ります。</p><button class="btn" id="more">明日の分も進める</button></div>`;
        $("#more").onclick = () => startStudy(true); return;
      }
      if (!study.queue.length) { startStudy(); if (study.queue.length) return; }
    }
    if (!study.queue.length) {
      host.innerHTML = `<div class="empty"><strong>全部覚えました</strong><p>「まだの単語」はありません。「すべて」に切り替えると全カードを復習できます。</p></div>`; return;
    }
    if (study.i >= study.queue.length) {
      host.innerHTML = `<div class="empty"><strong>${study.queue.length} 枚おわり</strong><p>覚えた ${study.known} 枚 / まだ ${study.queue.length - study.known} 枚</p><button class="btn primary" id="again">もう一周する</button></div>`;
      $("#again").onclick = startStudy; return;
    }
    const w = words.find(x => x.id === study.queue[study.i]);
    if (!w) { study.i++; return renderStudy(); }
    const enFront = ui.studyDir === "en";
    const front = enFront ? `<div class="big">${esc(w.en)}</div>` : `<div class="big ja">${esc(w.ja)}</div>`;
    const back = enFront
      ? `<div class="big ja">${esc(w.ja)}</div><div class="sub">${esc(w.en)}</div>`
      : `<div class="big">${esc(w.en)}</div><div class="sub">${esc(w.ja)}</div>`;
    host.innerHTML = `<div class="deck"><button class="card ${study.flipped ? "flipped" : ""}" id="card" aria-label="カードをめくる">
        <div class="face"><span class="count">${study.i + 1} / ${study.queue.length}</span>${lvDots(w.level || 0)}${front}<div class="hint">タップでめくる・スペースキー</div></div>
        <div class="face back"><span class="count">${study.i + 1} / ${study.queue.length}</span>${back}${w.ex ? `<p class="ex">${esc(w.ex)}</p>` : ""}</div>
      </button></div>
      <div class="actions" style="justify-content:center"><button class="btn ghost" id="say">${ICON_SPEAK.replace("<svg", '<svg width="16" height="16"')} 発音を聞く</button></div>
      <div class="judge"><button class="btn no" id="no">まだ <span class="msg">(←)</span></button><button class="btn yes" id="yes">覚えた <span style="opacity:.75;font-size:13px">(→)</span></button></div>`;
    $("#card").onclick = flip;
    $("#say").onclick = () => speak(w.en);
    $("#no").onclick = () => judge(w, false);
    $("#yes").onclick = () => judge(w, true);
  }
  function flip() { study.flipped = !study.flipped; $("#card")?.classList.toggle("flipped", study.flipped); }
  function judge(w, ok) {
    const lv = Math.max(0, Math.min(MAX_LV, (w.level || 0) + (ok ? 1 : -1)));
    if (ok) study.known++;
    study.i++; study.flipped = false;
    const next = markSeen({ ...w, level: lv });
    if (lv !== (w.level || 0) || next.seenRound !== w.seenRound) save(next).catch(() => {});
    renderStudy();
  }
  document.addEventListener("keydown", e => {
    if (ui.view !== "study" || e.target.closest("input,textarea,select") || $("#dlg-host").firstChild) return;
    const w = words.find(x => x.id === study.queue[study.i]); if (!w || !$("#card")) return;
    if (e.key === " ") { e.preventDefault(); flip(); }
    if (e.key === "ArrowRight") judge(w, true);
    if (e.key === "ArrowLeft") judge(w, false);
  });

  // ---------- quiz ----------
  let quiz = null;
  function startQuiz() {
    const pool = shuffle(words).sort((a, b) => (a.level || 0) - (b.level || 0)).slice(0, 10);
    quiz = { qs: shuffle(pool).map(w => w.id), i: 0, score: 0, picked: null, misses: [] };
    renderQuiz();
  }
  function renderQuiz() {
    const host = $("#quiz-host");
    if (store.mode === "loading") { host.innerHTML = `<div class="empty"><p>読み込み中…</p></div>`; return; }
    if (words.length < 4) { host.innerHTML = `<div class="empty"><strong>あと ${4 - words.length} 語でテストできます</strong><p>4択テストには単語が4つ以上必要です。</p></div>`; return; }
    if (!quiz) return startQuiz();
    if (quiz.i >= quiz.qs.length) {
      const miss = quiz.misses.map(id => words.find(w => w.id === id)).filter(Boolean);
      host.innerHTML = `<div class="q-word"><div class="msg">結果</div><div class="score">${quiz.score}<span style="font-size:24px;color:var(--muted)"> / ${quiz.qs.length}</span></div>
        ${miss.length ? `<div class="msg">まちがえた単語</div><div>${miss.map(w => `<div><b style="font-family:var(--f-word)">${esc(w.en)}</b> — ${esc(w.ja)}</div>`).join("")}</div>` : `<div class="msg">全問正解です</div>`}
        <div class="actions" style="justify-content:center;margin-top:8px"><button class="btn primary" id="retry">もう一度</button></div></div>`;
      $("#retry").onclick = startQuiz; return;
    }
    const w = words.find(x => x.id === quiz.qs[quiz.i]);
    if (!w) { quiz.i++; return renderQuiz(); }
    if (!quiz.opts) {
      const others = shuffle(words.filter(x => x.id !== w.id && x.ja !== w.ja && x.en !== w.en)).slice(0, 3);
      quiz.opts = shuffle([w, ...others]);
    }
    const toJa = ui.quizDir === "en";
    host.innerHTML = `<div class="q-word"><div class="msg">${quiz.i + 1} / ${quiz.qs.length}　${toJa ? "意味を選んでください" : "英単語を選んでください"}</div>
        <div class="big ${toJa ? "" : "ja"}">${esc(toJa ? w.en : w.ja)}</div></div>
      <div class="choices">${quiz.opts.map(o => {
        let cls = "";
        if (quiz.picked) cls = o.id === w.id ? "right" : (o.id === quiz.picked ? "wrong" : "");
        return `<button class="choice ${toJa ? "" : "en"} ${cls}" data-id="${o.id}" ${quiz.picked ? "disabled" : ""}>${esc(toJa ? o.ja : o.en)}</button>`;
      }).join("")}</div>
      ${quiz.picked ? `<div class="actions" style="justify-content:flex-end"><button class="btn primary" id="next">${quiz.i + 1 < quiz.qs.length ? "次へ" : "結果を見る"}</button></div>` : ""}`;
    host.querySelector(".choices").onclick = e => {
      const b = e.target.closest(".choice"); if (!b || quiz.picked) return;
      quiz.picked = b.dataset.id;
      const ok = quiz.picked === w.id;
      if (ok) quiz.score++; else quiz.misses.push(w.id);
      if (toJa) speak(w.en);
      const lv = Math.max(0, Math.min(MAX_LV, (w.level || 0) + (ok ? 1 : -1)));
      const next = markSeen({ ...w, level: lv });
      if (lv !== (w.level || 0) || next.seenRound !== w.seenRound) save(next).catch(() => {});
      renderQuiz();
    };
    $("#next")?.addEventListener("click", () => { quiz.i++; quiz.picked = null; quiz.opts = null; renderQuiz(); });
  }

  // ---------- render ----------
  let firstData = true;
  function render() {
    document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.view === ui.view));
    ["list", "study", "quiz"].forEach(v => $("#view-" + v).hidden = v !== ui.view);
    syncSegs();
    ensureToday();
    renderPlan(); renderStats(); renderList();
    if (store.mode !== "loading" && firstData) { firstData = false; startStudy(); quiz = null; }
    if (ui.view === "study") renderStudy();
    if (ui.view === "quiz") renderQuiz();
  }


  init();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
