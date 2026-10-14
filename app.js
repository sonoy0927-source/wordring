  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const MAX_LV = 3;
  // Shown next to the app name so you can tell which version a device is running. Keep in step with VERSION in sw.js.
  const APP_VERSION = "v11";
  document.querySelector(".brand span").textContent = `英単語帳 ${APP_VERSION}`;

  const ICON_SPEAK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>';
  const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

  // allWords holds every book; words is the current book's slice that the screens work on.
  let allWords = [], words = [];
  const MAIN_BOOK = "main";
  let books = [{ id: MAIN_BOOK, name: "マイ単語帳" }];
  const bookOf = w => w.book || MAIN_BOOK;
  const ui = { view: "list", sheet: false, q: "", tag: "", studyDir: "en", studySet: "todo", quizDir: "en", quizSet: "all", quizCountToday: "all", quizCountAll: 10, book: MAIN_BOOK };
  try { Object.assign(ui, JSON.parse(localStorage.getItem("wordring.ui") || "{}"), { q: "" }); } catch {}
  const saveUi = () => { try { localStorage.setItem("wordring.ui", JSON.stringify(ui)); } catch {} };

  // ---------- storage: Firestore when signed in, else this browser ----------
  // Firestore layout: users/{uid}/words/{wordId} (each word has a `book` field),
  // users/{uid}/words/_books for the book list, and one plan doc per book
  // (_plan for the first book, so data from before books existed keeps working; _plan_<bookId> for the rest).
  const LOCAL_KEY = "wordring.words", PLAN_KEY = "wordring.plan", PLANS_KEY = "wordring.plans", BOOKS_KEY = "wordring.books";
  const BOOKS_ID = "_books";
  const planDocId = b => b === MAIN_BOOK ? "_plan" : "_plan_" + b;
  let plans = {};   // bookId -> { days, start, round, todayDate, todayQuota }
  let plan = null;  // the current book's plan
  let fb = null;    // { auth, db, mod: firebase functions } once Firebase is configured
  let unsub = null;

  // Point words/plan at the current book after data or the selection changes.
  function applyBook() {
    if (!books.some(b => b.id === ui.book)) ui.book = books[0].id;
    words = allWords.filter(w => bookOf(w) === ui.book);
    plan = normPlan(plans[ui.book]);
  }

  const store = {
    mode: "loading", uid: null,
    ref(id) { return fb.mod.doc(fb.db, "users", this.uid, "words", id); },
    // Firestore writes are applied locally at once and synced in the background,
    // so we don't wait for the server (that would hang while offline).
    cloud(p) { p.catch(e => toast(e?.code === "permission-denied" ? "保存する権限がありません。ログインし直してください" : "同期に失敗しました。通信状況を確認してください")); },
    async putPlan(p) {
      plans = { ...plans, [ui.book]: p }; plan = p;
      if (this.mode === "db") { this.cloud(fb.mod.setDoc(this.ref(planDocId(ui.book)), p)); return; }
      this.saveLocal(); render();
    },
    async putBooks(list) {
      books = list;
      if (this.mode === "db") { this.cloud(fb.mod.setDoc(this.ref(BOOKS_ID), { list })); }
      else this.saveLocal();
      applyBook(); render();
    },
    async put(w) {
      const { id, ...body } = w;
      if (this.mode === "db") { this.cloud(fb.mod.setDoc(this.ref(id), body)); return; }
      const i = allWords.findIndex(x => x.id === id);
      if (i >= 0) allWords[i] = w; else allWords.push(w);
      this.saveLocal(); applyBook(); render();
    },
    async del(id) {
      if (this.mode === "db") { this.cloud(fb.mod.deleteDoc(this.ref(id))); return; }
      allWords = allWords.filter(x => x.id !== id); this.saveLocal(); applyBook(); render();
    },
    // Removes a book together with its words and plan.
    async delBook(bookId) {
      const ids = allWords.filter(w => bookOf(w) === bookId).map(w => w.id);
      const rest = books.filter(b => b.id !== bookId);
      if (this.mode === "db") {
        const refs = [...ids, planDocId(bookId)].map(id => this.ref(id));
        for (let i = 0; i < refs.length; i += 400) {
          const b = fb.mod.writeBatch(fb.db);
          refs.slice(i, i + 400).forEach(r => b.delete(r));
          this.cloud(b.commit());
        }
      } else {
        allWords = allWords.filter(w => bookOf(w) !== bookId);
        const { [bookId]: _, ...others } = plans; plans = others;
      }
      await this.putBooks(rest);
    },
    saveLocal() {
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(allWords));
        localStorage.setItem(PLANS_KEY, JSON.stringify(plans));
        localStorage.setItem(BOOKS_KEY, JSON.stringify(books));
      } catch {}
    },
    readLocal() {
      let w = [], p = {}, b = null;
      try { w = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); } catch {}
      try { p = JSON.parse(localStorage.getItem(PLANS_KEY) || "null") || {}; } catch {}
      try { const old = JSON.parse(localStorage.getItem(PLAN_KEY) || "null"); if (old && !p[MAIN_BOOK]) p[MAIN_BOOK] = old; } catch {}
      try { b = JSON.parse(localStorage.getItem(BOOKS_KEY) || "null"); } catch {}
      return { w, p, b: Array.isArray(b) && b.length ? b : null };
    },
    clearLocal() { try { [LOCAL_KEY, PLAN_KEY, PLANS_KEY, BOOKS_KEY].forEach(k => localStorage.removeItem(k)); } catch {} },
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
    const { w, p, b } = store.readLocal();
    allWords = w; plans = p; books = b || [{ id: MAIN_BOOK, name: "マイ単語帳" }];
    fixOldTags(); applyBook(); firstData = true;
    setSync(false, fb ? "この端末だけに保存中" : "この端末に保存");
    render();
  }
  function useCloud(uid) {
    unsub?.();
    store.mode = "db"; store.uid = uid;
    allWords = []; plans = {}; firstData = true;
    setSync(true, "PC・スマホで同期");
    const col = fb.mod.collection(fb.db, "users", uid, "words");
    unsub = fb.mod.onSnapshot(col, snap => {
      const nextPlans = {}, nextWords = [];
      let list = null;
      snap.docs.forEach(d => {
        if (d.id === BOOKS_ID) list = d.data().list;
        else if (d.id === "_plan") nextPlans[MAIN_BOOK] = { ...d.data() };
        else if (d.id.startsWith("_plan_")) nextPlans[d.id.slice(6)] = { ...d.data() };
        else nextWords.push({ id: d.id, ...d.data() });
      });
      allWords = nextWords; plans = nextPlans;
      books = Array.isArray(list) && list.length ? list : [{ id: MAIN_BOOK, name: "マイ単語帳" }];
      fixOldTags(); applyBook(); render();
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
    const { w, p, b: localBooks } = store.readLocal();
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
        if (i === 0) {
          Object.entries(p).forEach(([bookId, bp]) => { if (!plans[bookId]) b.set(store.ref(planDocId(bookId)), bp); });
          // Add this device's books to the account's list without dropping either side's.
          if (localBooks) {
            const merged = [...books, ...localBooks.filter(lb => !books.some(x => x.id === lb.id))];
            b.set(store.ref(BOOKS_ID), { list: merged });
          }
        }
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
  // Progress is kept separately for 英→日 ("en") and 日→英 ("ja").
  // Words saved before the split only have `level`, which counted as 英→日.
  const DIR_LABEL = { en: "英→日", ja: "日→英" };
  const lvOf = (w, dir) => dir === "ja" ? (w.levelJa || 0) : (w.levelEn ?? w.level ?? 0);
  const withLv = (w, dir, lv) => dir === "ja" ? { ...w, levelJa: lv } : { ...w, levelEn: lv };
  const lvPair = w => `<span class="lvs"><span class="lv-dir" title="英→日 ${lvOf(w, "en")}/${MAX_LV}">英${lvDots(lvOf(w, "en"))}</span><span class="lv-dir" title="日→英 ${lvOf(w, "ja")}/${MAX_LV}">日${lvDots(lvOf(w, "ja"))}</span></span>`;
  // Circled numbers in tags (①, ⑫, ㉑, ❸ …) become plain two-digit numbers (01, 12, 21, 03),
  // so tags like 第①章 and 第⑫章 read and sort the same way as typed numbers.
  const CIRCLED = [
    [0x2460, 0x2473, 1], [0x3251, 0x325F, 21], [0x32B1, 0x32BF, 36], [0x24EA, 0x24EA, 0],
    [0x24EB, 0x24F4, 11], [0x24F5, 0x24FE, 1], [0x2776, 0x277F, 1], [0x2780, 0x2789, 1], [0x278A, 0x2793, 1],
  ];
  function circledValue(ch) {
    const c = ch.codePointAt(0);
    for (const [lo, hi, first] of CIRCLED) if (c >= lo && c <= hi) return first + c - lo;
    return null;
  }
  const normTag = t => [...String(t || "")].map(ch => { const n = circledValue(ch); return n == null ? ch : String(n).padStart(2, "0"); }).join("");
  // Rewrites tags saved before this rule existed. Safe to run on every load: nothing changes twice.
  function fixOldTags() {
    const todo = allWords.filter(w => w.tag && normTag(w.tag) !== w.tag);
    if (!todo.length) return;
    if (store.mode === "db") {
      for (let i = 0; i < todo.length; i += 400) {
        const b = fb.mod.writeBatch(fb.db);
        todo.slice(i, i + 400).forEach(w => b.update(store.ref(w.id), { tag: normTag(w.tag) }));
        store.cloud(b.commit());
      }
    } else {
      allWords = allWords.map(w => w.tag ? { ...w, tag: normTag(w.tag) } : w);
      store.saveLocal(); applyBook();
    }
  }

  async function save(w) {
    if (w.tag) w = { ...w, tag: normTag(w.tag) };
    try { await store.put(w); }
    catch (e) { toast(e?.code === "quota_exceeded" ? "保存できる上限に達しました。不要な単語を削除してください" : "保存できませんでした。もう一度試してください"); throw e; }
  }

  // ---------- plan: words No.from–to spread over start–end dates, a fixed share per day ----------
  // Each day's words are fixed in advance. A day you skip is simply skipped (its words are not
  // pushed onto later days); you can still open any day from the schedule and do it.
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const toUTC = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const dayDiff = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
  const shiftDate = (s, n) => new Date(toUTC(s) + n * 86400000).toISOString().slice(0, 10);
  const fmtDate = s => { const d = new Date(toUTC(s)); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
  const dow = s => "日月火水木金土"[new Date(toUTC(s)).getUTCDay()];
  const fmtDay = s => `${fmtDate(s)}(${dow(s)})`;
  const rangeText = (a, b) => a > b ? "なし" : a === b ? `No.${a}` : `No.${a}〜${b}`;

  // Registration order gives every word in a book its No.
  function ordered(list = words) { return list.slice().sort((a, b) => (a.created || 0) - (b.created || 0) || (a.id < b.id ? -1 : 1)); }

  // Plans saved before date ranges existed ("finish in N days") become a range over the whole book.
  function normPlan(p) {
    if (!p) return null;
    if (p.end) return p;
    const start = p.start || todayStr();
    return { id: "p" + start, start, end: shiftDate(start, Math.max(1, p.days || 14) - 1), from: 1, to: null };
  }
  function scheduleFor(p, list = words) {
    const all = ordered(list);
    const from = Math.max(1, p.from || 1);
    const to = Math.min(all.length, p.to || all.length);
    const range = to >= from ? all.slice(from - 1, to) : [];
    const days = Math.max(1, dayDiff(p.start, p.end) + 1);
    const N = range.length;
    const day = k => {
      const a = Math.floor(k * N / days), b = Math.floor((k + 1) * N / days);
      return { k, date: shiftDate(p.start, k), from: from + a, to: from + b - 1, words: range.slice(a, b) };
    };
    return { from, to, N, days, day, today: dayDiff(p.start, todayStr()) };
  }
  const schedule = () => scheduleFor(plan);
  // The day "今日の分" points at: today, or day 1 before the plan starts.
  const currentDay = s => Math.min(Math.max(s.today, 0), s.days - 1);
  const studied = w => !!plan && w.seenPlan === plan.id;
  function markSeen(w) {
    return plan && w.seenPlan !== plan.id ? { ...w, seenPlan: plan.id, seenDate: todayStr() } : w;
  }

  let planEdit = false, freshPlan = false, schedOpen = false;
  function renderPlan() {
    const host = $("#plan-host");
    if (store.mode === "loading" || !words.length) { host.innerHTML = ""; return; }
    if (!plan || planEdit) return renderPlanForm(host);
    const s = schedule();
    const head = `<div class="eyebrow"><span>${fmtDay(plan.start)}〜${fmtDay(plan.end)} · ${s.days}日間</span><span>${rangeText(s.from, s.to)} · ${s.N}語</span></div>`;
    let body, actions;
    if (s.today >= s.days) {
      const done = s.N ? Array.from({ length: s.days }, (_, k) => s.day(k).words.filter(studied).length).reduce((a, b) => a + b, 0) : 0;
      body = `<div class="goal"><b>期間終了</b><span>${done} / ${s.N} 語やりました</span></div>`;
      actions = `<button class="btn" id="plan-new">新しい計画を立てる</button>`;
    } else {
      const k = currentDay(s), d = s.day(k), n = d.words.length, done = d.words.filter(studied).length;
      const pct = n ? Math.round(done / n * 100) : 100;
      const label = s.today < 0 ? `${fmtDay(plan.start)}から開始 · 1日目の分` : `今日 ${fmtDay(d.date)} · ${k + 1}日目`;
      const next = k + 1 < s.days ? s.day(k + 1) : null;
      let skipped = 0;
      for (let j = 0; j < Math.min(s.today, s.days); j++) skipped += s.day(j).words.filter(w => !studied(w)).length;
      body = `<div class="sub">${label}</div>
        ${n ? `<div class="goal"><b>${done}<span style="font-size:22px;opacity:.6"> / ${n}</span></b><span>${rangeText(d.from, d.to)}${done >= n ? " · 完了" : ""}</span></div>
        <div class="meter"><div style="width:${pct}%"></div></div>`
          : `<div class="goal"><b>0</b><span>この日の割り当てはありません</span></div>`}
        ${next ? `<div class="sub">明日 ${fmtDay(next.date)}：${rangeText(next.from, next.to)}（${next.words.length}語）</div>` : `<div class="sub">今日が最終日です</div>`}
        ${skipped ? `<div class="sub">前の日のやり残し ${skipped} 語はスキップしました。日程からいつでもできます。</div>` : ""}`;
      actions = n ? `<button class="btn" id="plan-go">${done >= n ? "今日の分をもう一度" : "今日の分を始める"}</button><button class="btn ghost" id="plan-quiz">今日の分をテスト</button>` : "";
    }
    host.innerHTML = `<div class="plan">${head}${body}
      <div class="actions">${actions}<button class="btn ghost" id="plan-edit">計画を変える</button></div>
      <details class="sched" ${schedOpen ? "open" : ""}><summary>日程を見る</summary><div class="sched-scroll"><table>
        <thead><tr><th>日付</th><th>範囲</th><th>語数</th><th>やった</th><th></th></tr></thead><tbody>
        ${Array.from({ length: s.days }, (_, k) => {
          const d = s.day(k), n = d.words.length, done = d.words.filter(studied).length;
          const cls = k === s.today ? "today" : k < s.today ? "past" : "";
          return `<tr class="${cls}"><td>${fmtDay(d.date)}${k === s.today ? " 今日" : ""}</td><td>${n ? rangeText(d.from, d.to) : "—"}</td><td>${n}</td>
            <td>${n ? (done >= n ? "✓" : `${done}/${n}`) : ""}</td><td>${n ? `<button class="btn sm" data-k="${k}">やる</button>` : ""}</td></tr>`;
        }).join("")}</tbody></table></div></details>
    </div>`;
    const goStudy = arg => { ui.view = "study"; ui.studySet = "today"; saveUi(); render(); startStudy(arg); window.scrollTo(0, 0); };
    $("#plan-go")?.addEventListener("click", () => { const s2 = schedule(), d = s2.day(currentDay(s2)); goStudy({ all: d.words.every(studied) }); });
    $("#plan-quiz")?.addEventListener("click", () => goQuizDay(currentDay(schedule())));
    $("#plan-new")?.addEventListener("click", () => { planEdit = true; freshPlan = true; renderPlan(); });
    $("#plan-edit").onclick = () => { planEdit = true; freshPlan = false; renderPlan(); };
    const det = host.querySelector("details.sched");
    det.ontoggle = () => { schedOpen = det.open; };
    det.querySelectorAll("button[data-k]").forEach(b => b.onclick = () => goStudy({ day: +b.dataset.k }));
  }

  function renderPlanForm(host) {
    const total = words.length;
    const base = plan && !freshPlan ? plan : null;
    const start0 = base?.start || todayStr();
    const end0 = base?.end || shiftDate(start0, 13);
    const from0 = base?.from || 1, to0 = base?.to || total, toEnd0 = base ? !base.to : true;
    host.innerHTML = `<form class="plan setup" id="plan-form" novalidate>
      <div class="section-h">${base ? "計画を変える" : "いつまでに、どの単語をやる？"}</div>
      <div class="pf-row"><span class="pf-label">期間</span>
        <input type="date" id="pf-start" value="${start0}" aria-label="開始日"><span>〜</span><input type="date" id="pf-end" value="${end0}" aria-label="終了日">
      </div>
      <div class="days-row">${[[7, "1週間"], [14, "2週間"], [30, "30日"], [60, "60日"]].map(([n, t]) => `<button type="button" class="preset" data-d="${n}">${t}</button>`).join("")}</div>
      <div class="pf-row"><span class="pf-label">単語</span>
        No.<input type="number" id="pf-from" min="1" max="${total}" value="${Math.min(from0, total)}" inputmode="numeric" aria-label="最初の番号">
        <span>〜</span>No.<input type="number" id="pf-to" min="1" max="${total}" value="${Math.min(to0, total)}" inputmode="numeric" aria-label="最後の番号" ${toEnd0 ? "disabled" : ""}>
      </div>
      <label class="pf-check"><input type="checkbox" id="pf-toend" ${toEnd0 ? "checked" : ""}> 最後の単語まで（あとで追加した単語も入れる）</label>
      <div class="calc" id="pf-calc"></div>
      <div class="pf-preview" id="pf-preview"></div>
      <div class="msg err" id="pf-err"></div>
      <div class="actions"><button class="btn primary" type="submit">${base ? "この計画に変える" : "この計画で始める"}</button>
        ${plan ? `<button class="btn ghost" type="button" id="plan-cancel">キャンセル</button>` : ""}</div>
      <div class="msg">番号は単語を登録した順です。毎日やる単語は最初に決まり、やらなかった日の分は次の日に回さずスキップします。</div>
    </form>`;
    const read = () => {
      const start = $("#pf-start").value, end = $("#pf-end").value;
      const from = parseInt($("#pf-from").value, 10), toEnd = $("#pf-toend").checked;
      const to = toEnd ? total : parseInt($("#pf-to").value, 10);
      let err = "";
      if (!start || !end) err = "開始日と終了日を入れてください";
      else if (end < start) err = "終了日は開始日より後にしてください";
      else if (!(from >= 1 && from <= total)) err = `最初の番号は 1〜${total} にしてください`;
      else if (!(to >= from && to <= total)) err = `最後の番号は ${from || 1}〜${total} にしてください`;
      return { start, end, from, to: toEnd ? null : to, err };
    };
    const update = () => {
      const f = read();
      $("#pf-to").disabled = $("#pf-toend").checked;
      if ($("#pf-toend").checked) $("#pf-to").value = total;
      $("#pf-err").textContent = f.err;
      if (f.err) { $("#pf-calc").innerHTML = ""; $("#pf-preview").innerHTML = ""; return; }
      const s = scheduleFor(f);
      const lo = Math.floor(s.N / s.days), hi = Math.ceil(s.N / s.days);
      $("#pf-calc").innerHTML = `<b>${s.N}</b> 語 ÷ <b>${s.days}</b> 日 → 1日 <b>${lo === hi ? lo : `${lo}〜${hi}`}</b> 語`;
      $("#pf-preview").innerHTML = Array.from({ length: Math.min(3, s.days) }, (_, k) => {
        const d = s.day(k); return `<div>${fmtDay(d.date)}　${d.words.length ? rangeText(d.from, d.to) : "なし"}（${d.words.length}語）</div>`;
      }).join("") + (s.days > 3 ? `<div>…　${fmtDay(f.end)}まで</div>` : "");
      host.querySelectorAll(".preset").forEach(b => b.setAttribute("aria-pressed", dayDiff(f.start, f.end) + 1 === +b.dataset.d));
    };
    host.querySelectorAll("input").forEach(i => i.addEventListener("input", update));
    host.querySelectorAll(".preset").forEach(b => b.onclick = () => { $("#pf-end").value = shiftDate($("#pf-start").value || todayStr(), +b.dataset.d - 1); update(); });
    $("#plan-cancel")?.addEventListener("click", () => { planEdit = false; renderPlan(); });
    $("#plan-form").onsubmit = async e => {
      e.preventDefault();
      const f = read(); if (f.err) { update(); return; }
      // Editing keeps the plan's id so words already done stay marked as done.
      const p = { id: base?.id || "p" + newId(), start: f.start, end: f.end, from: f.from, to: f.to };
      planEdit = false; freshPlan = false;
      await store.putPlan(p);
      const s = scheduleFor(p), lo = Math.floor(s.N / s.days), hi = Math.ceil(s.N / s.days);
      toast(`1日 ${lo === hi ? lo : `${lo}〜${hi}`} 語の計画にしました`); render();
    };
    update();
  }

  // ---------- tabs ----------
  document.querySelectorAll("nav.tabs button").forEach(b => b.onclick = () => { ui.view = b.dataset.view; saveUi(); render(); if (ui.view === "study") startStudy(); });

  // ---------- add form ----------
  $("#toggle-more").onclick = () => { const m = $("#more-fields"); m.hidden = !m.hidden; $("#toggle-more").textContent = m.hidden ? "例文・タグも入力" : "例文・タグを閉じる"; };
  $("#add-form").addEventListener("submit", async e => {
    e.preventDefault();
    const en = $("#in-en").value.trim(), ja = $("#in-ja").value.trim();
    if (!en || !ja) { $("#add-msg").className = "msg err"; $("#add-msg").textContent = "英単語と意味の両方を入力してください"; return; }
    if (store.mode === "loading") return;
    const dup = words.find(w => w.en.toLowerCase() === en.toLowerCase());
    const w = { id: newId(), en, ja, ex: $("#in-ex").value.trim(), tag: $("#in-tag").value.trim(), book: ui.book, level: 0, created: Date.now() };
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
    const total = words.length;
    $("#st-total").textContent = total;
    ["en", "ja"].forEach(dir => {
      const done = words.filter(w => lvOf(w, dir) >= MAX_LV).length, pct = total ? Math.round(done / total * 100) : 0;
      $("#st-" + dir).textContent = done;
      $("#st-" + dir + "-pct").textContent = pct + "%";
      $("#st-" + dir + "-bar").style.width = pct + "%";
    });
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
    const no = new Map(ordered().map((w, i) => [w.id, i + 1]));
    host.innerHTML = `<ul class="words ${ui.sheet ? "sheet-on" : ""}">` + list.map(w => `
      <li data-id="${w.id}">
        <div class="w-en"><span class="no">${no.get(w.id)}</span>${esc(w.en)}${w.tag ? ` <span class="tag">${esc(w.tag)}</span>` : ""}</div>
        <div class="w-meta">${lvPair(w)}
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
      try { await save({ id: newId(), en: s[i][0], ja: s[i][1], ex: s[i][2], tag: "サンプル", book: ui.book, level: 0, created: now + i }); } catch { return; }
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
      ${books.length > 1 ? `<label class="f">本<select id="ed-book">${books.map(b => `<option value="${esc(b.id)}" ${b.id === bookOf(w) ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>` : ""}
      <div class="actions">
        <button class="btn primary" type="submit">保存</button>
        <button class="btn ghost" type="button" id="ed-cancel">キャンセル</button>
        <span style="flex:1"></span>
        <button class="btn" type="button" id="ed-reset">習熟度をリセット</button>
        <button class="btn danger" type="button" id="ed-del">削除</button>
      </div></form></div>`;
    $("#ov").onclick = e => { if (e.target.id === "ov") closeDlg(); };
    $("#ed-cancel").onclick = closeDlg;
    $("#ed-reset").onclick = async () => { try { await save({ ...w, level: 0, levelEn: 0, levelJa: 0 }); } catch { return; } closeDlg(); toast("習熟度をリセットしました"); };
    $("#ed-del").onclick = async e => {
      const b = e.currentTarget;
      if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "本当に削除する"; return; }
      try { await store.del(w.id); } catch { toast("削除できませんでした"); return; }
      closeDlg(); toast(`「${w.en}」を削除しました`);
    };
    $("#ed").onsubmit = async e => {
      e.preventDefault();
      const en = $("#ed-en").value.trim(), ja = $("#ed-ja").value.trim(); if (!en || !ja) return;
      const book = $("#ed-book")?.value || bookOf(w);
      // Progress belongs to a book's plan, so a moved word starts fresh in its new book.
      const moved = book !== bookOf(w) ? { seenPlan: null, seenDate: null } : {};
      try { await save({ ...w, en, ja, ex: $("#ed-ex").value.trim(), tag: $("#ed-tag").value.trim(), book, ...moved }); } catch { return; }
      closeDlg(); toast(moved.seenDate === null ? `「${books.find(b => b.id === book)?.name}」に移しました` : "保存しました");
    };
  }

  // One line of the bulk list -> [en, ja, ex].
  // Tab-separated (pasted from a spreadsheet): columns as they are, so commas inside a cell stay.
  // Otherwise the first comma splits the word from its meaning; later commas belong to the meaning
  // (e.g. "run, 走る, 運営する"), and the example starts at the first part with no Japanese in it.
  // "|" can also be used to mark where the example starts.
  const HAS_JA = /[\u3040-\u30ff\u3400-\u9fff\uff01-\uff5e]/;
  function parseLine(line) {
    if (line.includes("\t")) {
      const c = line.split("\t").map(x => x.trim());
      return [c[0], c[1], c.slice(2).filter(Boolean).join(" ")];
    }
    const m = line.match(/^([^,，]*)[,，](.*)$/);
    if (!m) return [line.trim(), "", ""];
    const en = m[1].trim();
    let rest = m[2], ex = "";
    const bar = rest.search(/[|｜]/);
    if (bar >= 0) { ex = rest.slice(bar + 1).trim(); rest = rest.slice(0, bar); }
    else {
      const parts = rest.split(/[,，]/);
      const i = parts.findIndex((x, j) => j > 0 && /[a-z]/i.test(x) && !HAS_JA.test(x));
      if (i > 0) { ex = parts.slice(i).join(",").trim(); rest = parts.slice(0, i).join(","); }
    }
    const ja = rest.split(/[,，]/).map(x => x.trim()).filter(Boolean).join(", ");
    return [en, ja, ex];
  }

  $("#open-import").onclick = () => {
    $("#dlg-host").innerHTML = `<div class="overlay" id="ov"><form class="dlg" id="im">
      <h3>まとめて追加</h3>
      <p class="msg" style="margin:0">1行に1単語。最初の「,」で英単語と意味を分けます。意味はいくつ「,」で並べても大丈夫です。例文は意味のあとに英文で続けて書けます。Excel やスプレッドシートからそのまま貼り付けることもできます。</p>
      <label class="f">単語リスト<textarea id="im-text" placeholder="apple, りんご&#10;run, 走る, 運営する, 流れる&#10;borrow, 借りる, Can I borrow your pen?"></textarea></label>
      <div class="im-preview" id="im-preview" hidden></div>
      <label class="f">タグ（任意・全部に付きます）<input type="text" id="im-tag" placeholder="例: 第5章"></label>
      <div class="actions"><button class="btn primary" type="submit">追加する</button><button class="btn ghost" type="button" id="im-cancel">キャンセル</button></div>
      <div class="msg" id="im-msg"></div></form></div>`;
    $("#ov").onclick = e => { if (e.target.id === "ov") closeDlg(); };
    $("#im-cancel").onclick = closeDlg;
    const parseAll = () => $("#im-text").value.split(/\r?\n/).filter(l => l.trim()).map(parseLine);
    $("#im-text").oninput = () => {
      const rows = parseAll(), ok = rows.filter(r => r[0] && r[1]), bad = rows.length - ok.length;
      const box = $("#im-preview"); box.hidden = !rows.length;
      box.innerHTML = `<div class="msg">${ok.length} 語を読み取りました${bad ? `（意味がない ${bad} 行は追加しません）` : ""}。最初の ${Math.min(3, ok.length)} 語：</div>
        <table><thead><tr><th>英単語</th><th>意味</th><th>例文</th></tr></thead><tbody>${ok.slice(0, 3).map(r =>
          `<tr><td class="en">${esc(r[0])}</td><td>${esc(r[1])}</td><td class="ex">${esc(r[2]) || "—"}</td></tr>`).join("")}</tbody></table>`;
    };
    $("#im").onsubmit = async e => {
      e.preventDefault();
      const tag = $("#im-tag").value.trim();
      const rows = parseAll().filter(r => r[0] && r[1]);
      if (!rows.length) { $("#im-msg").className = "msg err"; $("#im-msg").textContent = "「英単語, 意味」の形の行が見つかりません"; return; }
      const btn = e.submitter || $("#im button[type=submit]"); btn.disabled = true;
      const now = Date.now();
      for (let i = 0; i < rows.length; i++) {
        $("#im-msg").textContent = `${i + 1} / ${rows.length} 件を追加中…`;
        try { await save({ id: newId(), en: rows[i][0], ja: rows[i][1], ex: rows[i][2], tag, book: ui.book, level: 0, created: now + i }); }
        catch { btn.disabled = false; return; }
      }
      closeDlg(); toast(`${rows.length} 件を追加しました`);
    };
  };

  // ---------- flashcards ----------
  let study = { queue: [], i: 0, flipped: false, known: 0, missed: [] };
  function segBind(id, key, after) {
    const el = $("#" + id);
    el.onclick = e => { const b = e.target.closest("button"); if (!b) return; ui[key] = b.dataset.v; saveUi(); syncSegs(); after(); };
  }
  function syncSegs() {
    [["study-dir", "studyDir"], ["study-set", "studySet"], ["quiz-dir", "quizDir"], ["quiz-set", "quizSet"]].forEach(([id, k]) =>
      $("#" + id).querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === ui[k])));
  }
  segBind("study-dir", "studyDir", () => { if (ui.studySet === "todo") startStudy(); else { study.flipped = false; renderStudy(); } });
  segBind("study-set", "studySet", () => { study.day = null; startStudy(); });
  segBind("quiz-dir", "quizDir", () => { quiz = null; renderQuiz(); });
  segBind("quiz-set", "quizSet", () => { quiz = null; quizDay = null; renderQuiz(); });

  // extra for the 今日の分 set: {} = today's words not done yet, {day: k} = that day's words,
  // {all: true} = all of the day's words again, "missed" = only the ones marked まだ last time.
  function startStudy(extra) {
    let pool = [], day = study.day ?? null;
    if (ui.studySet === "today" && extra === "missed") {
      pool = shuffle(study.missed.map(id => words.find(w => w.id === id)).filter(Boolean));
    } else if (ui.studySet === "today") {
      if (plan) {
        const s = schedule(), opt = extra && typeof extra === "object" ? extra : {};
        day = opt.day ?? currentDay(s);
        const ended = opt.day == null && s.today >= s.days;
        const d = ended ? { words: [] } : s.day(day);
        const undone = d.words.filter(w => !studied(w));
        pool = shuffle(opt.all ? d.words : undone.length ? undone : opt.day != null ? d.words : []);
      }
    } else {
      pool = shuffle(ui.studySet === "todo" ? words.filter(w => lvOf(w, ui.studyDir) < MAX_LV) : words);
    }
    study = { queue: pool.map(w => w.id), i: 0, flipped: false, known: 0, missed: [], day };
    renderStudy();
  }
  function goPlan() { ui.view = "list"; saveUi(); render(); $("#plan-host").scrollIntoView({ block: "start" }); }
  function renderStudyPlan() {
    // Starts with the book's name: on phones the book tabs are hidden on this screen.
    const el = $("#study-plan");
    if (!words.length || store.mode === "loading") { el.hidden = true; return; }
    el.hidden = false;
    if (!plan) { el.textContent = bookName(); return; }
    const s = schedule();
    if (s.today >= s.days) { el.textContent = `${bookName()} · 計画の期間（〜${fmtDay(plan.end)}）は終わりました`; return; }
    const d = s.day(currentDay(s));
    el.textContent = `${bookName()} · ${s.today < 0 ? "1日目" : "今日"} ${d.words.filter(studied).length} / ${d.words.length} 語 · ${rangeText(d.from, d.to)}`;
  }
  function renderStudy() {
    const host = $("#study-host");
    renderStudyPlan();
    if (store.mode === "loading") { host.innerHTML = `<div class="empty"><p>読み込み中…</p></div>`; return; }
    if (!words.length) { host.innerHTML = `<div class="empty"><strong>カードがまだありません</strong><p>「単語」タブで単語を追加すると、ここで暗記カードとして練習できます。</p></div>`; return; }
    if (ui.studySet === "today" && !plan) {
      host.innerHTML = `<div class="empty"><strong>まだ計画がありません</strong><p>いつからいつまでに、どの単語をやるかを決めると、毎日やる単語が決まります。</p><button class="btn primary" id="to-plan">計画を立てる</button></div>`;
      $("#to-plan").onclick = goPlan; return;
    }
    if (ui.studySet === "today" && (!study.queue.length || study.i >= study.queue.length)) {
      const s = schedule();
      const k = study.day ?? currentDay(s);
      if (s.today >= s.days && study.day == null) {
        host.innerHTML = `<div class="empty"><strong>計画の期間が終わりました</strong><p>${fmtDay(plan.start)}〜${fmtDay(plan.end)} の計画でした。新しい計画は「単語」タブで立てられます。</p><button class="btn primary" id="to-plan">計画を見る</button></div>`;
        $("#to-plan").onclick = goPlan; return;
      }
      const d = s.day(k), n = d.words.length, isToday = k === currentDay(s);
      const next = k + 1 < s.days ? s.day(k + 1) : null;
      const title = !n ? "この日の割り当てはありません" : `${isToday ? (s.today < 0 ? "1日目の" : "今日の") : fmtDay(d.date) + "の"} ${n} 語 ${d.words.every(studied) ? "完了" : "おわり"}`;
      const m = study.missed.length;
      host.innerHTML = `<div class="empty"><strong>${title}</strong>
        <p>${study.queue.length ? `覚えた ${study.known} 枚 / まだ ${study.queue.length - study.known} 枚。` : ""}${n ? "何度でも繰り返せます。" : ""}</p>
        <div class="actions" style="justify-content:center">
          ${n ? `<button class="btn primary" id="rv-all">この ${n} 語をもう一度</button>` : ""}
          ${m && m < n ? `<button class="btn" id="rv-missed">「まだ」の ${m} 語だけ</button>` : ""}
          ${n && words.length >= 4 ? `<button class="btn" id="rv-quiz">この ${n} 語をテスト</button>` : ""}
          ${next && next.words.length ? `<button class="btn" id="rv-next">次の日 ${fmtDay(next.date)} の分（${next.words.length}語）</button>` : ""}
        </div></div>`;
      $("#rv-all")?.addEventListener("click", () => startStudy({ day: k, all: true }));
      $("#rv-missed")?.addEventListener("click", () => startStudy("missed"));
      $("#rv-quiz")?.addEventListener("click", () => goQuizDay(k));
      $("#rv-next")?.addEventListener("click", () => startStudy({ day: k + 1 }));
      return;
    }
    if (!study.queue.length) {
      host.innerHTML = `<div class="empty"><strong>全部覚えました</strong><p>「まだの単語」はありません。「すべて」に切り替えると全カードを復習できます。</p></div>`; return;
    }
    if (study.i >= study.queue.length) {
      host.innerHTML = `<div class="empty"><strong>${study.queue.length} 枚おわり</strong><p>覚えた ${study.known} 枚 / まだ ${study.queue.length - study.known} 枚</p><button class="btn primary" id="again">もう一周する</button></div>`;
      $("#again").onclick = () => startStudy(); return;
    }
    const w = words.find(x => x.id === study.queue[study.i]);
    if (!w) { study.i++; return renderStudy(); }
    const enFront = ui.studyDir === "en";
    const front = enFront ? `<div class="big">${esc(w.en)}</div>` : `<div class="big ja">${esc(w.ja)}</div>`;
    const back = enFront
      ? `<div class="big ja">${esc(w.ja)}</div><div class="sub">${esc(w.en)}</div>`
      : `<div class="big">${esc(w.en)}</div><div class="sub">${esc(w.ja)}</div>`;
    host.innerHTML = `<div class="deck"><button class="card ${study.flipped ? "flipped" : ""}" id="card" aria-label="カードをめくる">
        <div class="face"><span class="count">${study.i + 1} / ${study.queue.length}</span><span class="lv-dir card-lv">${DIR_LABEL[ui.studyDir]} ${lvDots(lvOf(w, ui.studyDir))}</span>${front}<div class="hint">タップでめくる・スペースキー</div></div>
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
    const dir = ui.studyDir, before = lvOf(w, dir);
    const lv = Math.max(0, Math.min(MAX_LV, before + (ok ? 1 : -1)));
    if (ok) study.known++; else study.missed.push(w.id);
    study.i++; study.flipped = false;
    const next = markSeen(withLv(w, dir, lv));
    if (lv !== before || next.seenPlan !== w.seenPlan) save(next).catch(() => {});
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
  // The テスト tab opens on a settings screen (direction, which words, how many questions);
  // 「テストを始める」 then runs the questions with the settings hidden.
  let quiz = null;    // the running test, or null while choosing settings
  let quizDay = null; // plan day chosen from another screen; null = today
  const bookName = () => books.find(b => b.id === ui.book)?.name || "";

  // Which words the selected set covers, and how to describe it.
  function quizSource() {
    if (ui.quizSet !== "today") {
      return { words, label: `「${bookName()}」の ${words.length} 語から（まだ覚えていない単語を優先）` };
    }
    if (!plan) return { err: "noplan", words: [] };
    const s = schedule();
    if (quizDay == null && s.today >= s.days) return { err: "ended", words: [] };
    const k = quizDay ?? currentDay(s), d = s.day(k);
    return { words: d.words, label: `${k === s.today ? "今日" : fmtDay(d.date)}の分 · ${rangeText(d.from, d.to)}（${d.words.length}語）` };
  }
  // opt.ids: run exactly these words again (e.g. the misses).
  function startQuiz(opt = {}) {
    let ids, label;
    if (opt.ids) { ids = opt.ids; label = `${quiz?.label || ""} · まちがえた単語だけ`; }
    else {
      const src = quizSource();
      if (src.err || !src.words.length) { quiz = null; return renderQuiz(); }
      // From the whole book, words not yet learned in this direction come first.
      const pool = ui.quizSet === "today" ? shuffle(src.words) : shuffle(src.words).sort((a, b) => lvOf(a, ui.quizDir) - lvOf(b, ui.quizDir));
      ids = pool.slice(0, quizCount(src.words.length)).map(w => w.id);
      label = src.label;
    }
    quiz = { qs: shuffle(ids), i: 0, score: 0, picked: null, misses: [], label };
    renderQuiz(); window.scrollTo(0, 0);
  }
  // Number of questions for the current set ("all" = every word available).
  const countKey = () => ui.quizSet === "today" ? "quizCountToday" : "quizCountAll";
  const quizCount = available => ui[countKey()] === "all" ? available : Math.min(available, ui[countKey()]);
  function renderQuizCount() {
    const host = $("#quiz-count"), cur = ui[countKey()];
    // Redraw only when the choice changes, so a number being typed isn't wiped by a sync.
    const key = ui.quizSet + ":" + cur;
    if (host.dataset.key === key) return;
    host.dataset.key = key;
    const presets = [5, 10, 20, 30];
    host.innerHTML = `<span class="msg">問題数</span>
      ${presets.map(n => `<button class="preset" data-n="${n}" aria-pressed="${cur === n}">${n}問</button>`).join("")}
      <button class="preset" data-n="all" aria-pressed="${cur === "all"}">全部</button>
      <label class="count-custom ${cur !== "all" && !presets.includes(cur) ? "on" : ""}"><input type="number" id="quiz-n" min="1" max="999" inputmode="numeric" value="${cur !== "all" && !presets.includes(cur) ? cur : ""}" placeholder="自由" aria-label="問題数を入力">問</label>`;
    const set = v => { ui[countKey()] = v; saveUi(); renderQuiz(); };
    host.querySelectorAll(".preset").forEach(b => b.onclick = () => set(b.dataset.n === "all" ? "all" : +b.dataset.n));
    $("#quiz-n").onchange = e => { const n = parseInt(e.target.value, 10); if (n >= 1) set(Math.min(999, n)); };
  }
  function renderQuizSetup(host) {
    const src = quizSource();
    if (src.err === "noplan") {
      host.innerHTML = `<div class="empty"><strong>まだ計画がありません</strong><p>いつからいつまでに、どの単語をやるかを決めると、毎日の分をテストできます。</p><button class="btn primary" id="to-plan">計画を立てる</button></div>`;
      $("#to-plan").onclick = goPlan; return;
    }
    if (src.err === "ended" || !src.words.length) {
      host.innerHTML = `<div class="empty"><strong>${src.err === "ended" ? "計画の期間が終わりました" : "この日の割り当てはありません"}</strong><p>「本全体から」に切り替えると、本の中からテストできます。</p></div>`;
      return;
    }
    const n = quizCount(src.words.length), want = ui[countKey()];
    host.innerHTML = `<div class="q-setup">
      <div class="msg">${esc(src.label)}</div>
      <div class="setup-count"><b>${n}</b> 問　<span class="msg">${DIR_LABEL[ui.quizDir]}・4択</span></div>
      ${want !== "all" && want > src.words.length ? `<div class="msg">${src.words.length} 語しかないので ${n} 問です</div>` : ""}
      <button class="btn primary start" id="quiz-start">テストを始める</button>
    </div>`;
    $("#quiz-start").onclick = () => startQuiz();
  }
  function renderQuiz() {
    const host = $("#quiz-host");
    document.body.classList.toggle("quiz-active", !!quiz && ui.view === "quiz");
    if (store.mode === "loading") { host.innerHTML = `<div class="empty"><p>読み込み中…</p></div>`; return; }
    if (words.length < 4) { host.innerHTML = `<div class="empty"><strong>あと ${4 - words.length} 語でテストできます</strong><p>4択テストには単語が4つ以上必要です。</p></div>`; return; }
    renderQuizCount();
    if (!quiz) return renderQuizSetup(host);
    const finished = quiz.i >= quiz.qs.length;
    const bar = `<div class="q-bar"><span class="q-label">${esc(quiz.label)}</span><button class="link" id="quiz-quit">${finished ? "設定に戻る" : "やめる"}</button></div>`;
    const bindQuit = () => $("#quiz-quit").onclick = () => { quiz = null; renderQuiz(); };
    if (finished) {
      const miss = quiz.misses.map(id => words.find(w => w.id === id)).filter(Boolean);
      host.innerHTML = `${bar}<div class="q-word"><div class="msg">結果</div><div class="score">${quiz.score}<span style="font-size:24px;color:var(--muted)"> / ${quiz.qs.length}</span></div>
        ${miss.length ? `<div class="msg">まちがえた単語</div><div class="miss-list">${miss.map(w => `<div><b style="font-family:var(--f-word)">${esc(w.en)}</b> — ${esc(w.ja)}</div>`).join("")}</div>` : `<div class="msg">全問正解です</div>`}
        <div class="actions" style="justify-content:center;margin-top:8px">
          ${miss.length ? `<button class="btn primary" id="retry-miss">まちがえた ${miss.length} 語だけもう一度</button>` : ""}
          <button class="btn ${miss.length ? "" : "primary"}" id="retry">同じ設定でもう一度</button>
        </div></div>`;
      bindQuit();
      $("#retry-miss")?.addEventListener("click", () => startQuiz({ ids: miss.map(w => w.id) }));
      $("#retry").onclick = () => startQuiz();
      return;
    }
    const w = words.find(x => x.id === quiz.qs[quiz.i]);
    if (!w) { quiz.i++; return renderQuiz(); }
    if (!quiz.opts) {
      const others = shuffle(words.filter(x => x.id !== w.id && x.ja !== w.ja && x.en !== w.en)).slice(0, 3);
      quiz.opts = shuffle([w, ...others]);
    }
    const toJa = ui.quizDir === "en";
    host.innerHTML = `${bar}<div class="q-word"><div class="msg">${quiz.i + 1} / ${quiz.qs.length}　${toJa ? "意味を選んでください" : "英単語を選んでください"}</div>
        <div class="big ${toJa ? "" : "ja"}">${esc(toJa ? w.en : w.ja)}</div></div>
      <div class="choices">${quiz.opts.map(o => {
        let cls = "";
        if (quiz.picked) cls = o.id === w.id ? "right" : (o.id === quiz.picked ? "wrong" : "");
        return `<button class="choice ${toJa ? "" : "en"} ${cls}" data-id="${o.id}" ${quiz.picked ? "disabled" : ""}>${esc(toJa ? o.ja : o.en)}</button>`;
      }).join("")}</div>
      <button class="btn primary next" id="next" ${quiz.picked ? "" : "hidden"}>${quiz.i + 1 < quiz.qs.length ? "次へ" : "結果を見る"}</button>`;
    bindQuit();
    host.querySelector(".choices").onclick = e => {
      const b = e.target.closest(".choice"); if (!b || quiz.picked) return;
      quiz.picked = b.dataset.id;
      const ok = quiz.picked === w.id;
      if (ok) quiz.score++; else quiz.misses.push(w.id);
      if (toJa) speak(w.en);
      const before = lvOf(w, ui.quizDir);
      const lv = Math.max(0, Math.min(MAX_LV, before + (ok ? 1 : -1)));
      const next = markSeen(withLv(w, ui.quizDir, lv));
      if (lv !== before || next.seenPlan !== w.seenPlan) save(next).catch(() => {});
      renderQuiz();
    };
    $("#next").onclick = () => { quiz.i++; quiz.picked = null; quiz.opts = null; renderQuiz(); };
  }
  // Opens the テスト tab's settings on a plan day's words (from the plan panel or the card screen).
  function goQuizDay(k) { ui.view = "quiz"; ui.quizSet = "today"; quizDay = k; quiz = null; saveUi(); render(); window.scrollTo(0, 0); }

  // ---------- books ----------
  function switchBook(id) {
    if (id === ui.book) return;
    ui.book = id; ui.tag = ""; saveUi();
    planEdit = false; freshPlan = false; quiz = null; quizDay = null; study.day = null;
    $("#add-msg").textContent = ""; $("#q").value = ""; ui.q = "";
    applyBook(); render();
    if (ui.view === "study") startStudy();
  }
  function renderBooks() {
    const host = $("#bookbar");
    if (store.mode === "loading") { host.innerHTML = ""; return; }
    const count = id => allWords.filter(w => bookOf(w) === id).length;
    host.innerHTML = `<div class="books" role="tablist" aria-label="本">${books.map(b => `
        <button class="book-chip" role="tab" data-id="${esc(b.id)}" aria-selected="${b.id === ui.book}">
          <span class="book-name">${esc(b.name)}</span><span class="book-count">${count(b.id)}</span></button>`).join("")}
        <button class="book-chip add" id="book-add" aria-label="本を追加">＋ 本を追加</button>
      </div>
      <button class="icon-btn" id="book-manage" aria-label="本の名前変更・削除" title="本の名前変更・削除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button>`;
    host.querySelectorAll(".book-chip[data-id]").forEach(b => b.onclick = () => switchBook(b.dataset.id));
    $("#book-add").onclick = openAddBook;
    $("#book-manage").onclick = openManageBooks;
    host.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function openAddBook() {
    $("#dlg-host").innerHTML = `<div class="overlay" id="ov"><form class="dlg" id="bk" autocomplete="off">
      <h3>本を追加</h3>
      <p class="msg" style="margin:0">単語集や教科書ごとに分けて登録できます。1日の単語数の計画も本ごとに立てられます。</p>
      <label class="f">本の名前<input type="text" id="bk-name" placeholder="例: ターゲット1900、英検2級 でる順" maxlength="40" required></label>
      <div class="actions"><button class="btn primary" type="submit">追加する</button><button class="btn ghost" type="button" id="bk-cancel">キャンセル</button></div>
    </form></div>`;
    $("#ov").onclick = e => { if (e.target.id === "ov") closeDlg(); };
    $("#bk-cancel").onclick = closeDlg;
    $("#bk-name").focus();
    $("#bk").onsubmit = async e => {
      e.preventDefault();
      const name = $("#bk-name").value.trim(); if (!name) return;
      const id = "b" + newId();
      closeDlg();
      await store.putBooks([...books, { id, name }]);
      switchBook(id);
      toast(`「${name}」を追加しました`);
    };
  }
  function openManageBooks() {
    const count = id => allWords.filter(w => bookOf(w) === id).length;
    $("#dlg-host").innerHTML = `<div class="overlay" id="ov"><form class="dlg" id="bm" autocomplete="off">
      <h3>本の名前変更・削除</h3>
      <div class="book-rows">${books.map(b => `
        <div class="book-row" data-id="${esc(b.id)}">
          <input type="text" value="${esc(b.name)}" maxlength="40" aria-label="本の名前" required>
          <span class="msg">${count(b.id)} 語</span>
          ${books.length > 1 ? `<button class="btn danger sm" type="button" data-del>削除</button>` : ""}
        </div>`).join("")}</div>
      <p class="msg" style="margin:0">本を削除すると、その本の単語と計画もすべて消えます。元に戻せません。</p>
      <div class="actions"><button class="btn primary" type="submit">名前を保存</button><button class="btn ghost" type="button" id="bm-cancel">閉じる</button></div>
    </form></div>`;
    $("#ov").onclick = e => { if (e.target.id === "ov") closeDlg(); };
    $("#bm-cancel").onclick = closeDlg;
    $("#bm").querySelectorAll("[data-del]").forEach(btn => btn.onclick = async () => {
      const id = btn.closest(".book-row").dataset.id, bk = books.find(b => b.id === id);
      if (!btn.classList.contains("armed")) { btn.classList.add("armed"); btn.textContent = `${count(id)} 語ごと削除`; return; }
      closeDlg();
      if (ui.book === id) switchBook(books.find(b => b.id !== id).id);
      await store.delBook(id);
      toast(`「${bk.name}」を削除しました`);
    });
    $("#bm").onsubmit = async e => {
      e.preventDefault();
      const names = Object.fromEntries([...$("#bm").querySelectorAll(".book-row")].map(r => [r.dataset.id, r.querySelector("input").value.trim()]));
      const next = books.map(b => ({ ...b, name: names[b.id] || b.name }));
      closeDlg();
      if (next.some((b, i) => b.name !== books[i].name)) { await store.putBooks(next); toast("保存しました"); }
    };
  }

  // ---------- render ----------
  let firstData = true;
  function render() {
    document.body.dataset.view = ui.view;
    document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.view === ui.view));
    ["list", "study", "quiz"].forEach(v => $("#view-" + v).hidden = v !== ui.view);
    syncSegs();
    renderBooks(); renderPlan(); renderStats(); renderList();
    if (store.mode !== "loading" && firstData) { firstData = false; startStudy(); quiz = null; }
    if (ui.view === "study") renderStudy();
    if (ui.view === "quiz") renderQuiz();
  }


  init();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
