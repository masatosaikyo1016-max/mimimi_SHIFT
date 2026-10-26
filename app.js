// シフト調整・自動編成アプリ (Hoa Hoa / guu table / GALLERY)
const STORAGE_KEY = "shift_manager_v4_data";
const SHARED_ACCESS_KEY = "hhgt_8x9k2m4p7w3q";
const ACCESS_TOKEN_STORAGE_KEY = "shift_manager_access_key";

// 営業時間
// Hoa Hoa / guu table : 10:00 - 23:00
// GALLERY             : 10:00 - 19:00
const OPEN_HOUR = 10;
const CLOSE_HOUR = 23;
const GALLERY_CLOSE_HOUR = 19;
const GALLERY_CLOSE_STR = "19:00";
const LATE_SUPPORT_END_STR = "22:00";
const LATE_SUPPORT_END_MIN = 22 * 60;

// 部門定義
const SHOPS = ["Hoa Hoa", "guu table", "GALLERY"];

// GALLERY勤務が可能な4名
const GALLERY_ALLOWED_MEMBERS = ["塩沢", "内山", "岡村", "大塚"];

// 遅番不足時に22:00までの出勤に入る対象3名（※大塚は対象外）
const LATE_SUPPORT_MEMBERS = ["岡村", "内山", "塩沢"];

// アプリ状態
let state = {
  currentMonth: getInitialMonth(), // YYYY-MM
  inputMode: "single", // "single" | "multi"
  selectedMultiDates: new Set(),
  multiDateTimes: {}, // { "YYYY-MM-DD": { start1, end1, start2, end2 } }
  currentView: "calendar", // "calendar" | "matrix" | "daily"
  shopFilter: "ALL",
  selectedDailyDate: "",
  shifts: []
  // shift要素: { id, date, name, start, end, shop, requestedShop, isLateSupport }
};

function getInitialMonth() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// スタッフ名がGALLERY勤務可能（塩沢・内山・岡村・大塚）か判定
function isGalleryEligible(rawName) {
  if (!rawName) return false;
  const normalized = rawName.trim().replace(/\s+/g, "");
  return GALLERY_ALLOWED_MEMBERS.some(
    (allowed) => normalized.startsWith(allowed) || normalized === allowed
  );
}

// スタッフ名が遅番22:00補充対象（岡村・内山・塩沢の3名）か判定
function isLateSupportEligible(rawName) {
  if (!rawName) return false;
  const normalized = rawName.trim().replace(/\s+/g, "");
  return LATE_SUPPORT_MEMBERS.some(
    (allowed) => normalized.startsWith(allowed) || normalized === allowed
  );
}

// 時間文字列 ("10:30") を分に変換
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

// 2つの時間帯が重なっているか判定（接しているだけ e.g. 10-19 と 19-22 は重ならない＝false）
function isTimeOverlapping(startA, endA, startB, endB) {
  return timeToMinutes(startA) < timeToMinutes(endB) && timeToMinutes(endA) > timeToMinutes(startB);
}

// GALLERYの営業時間（10:00〜19:00）内かどうか判定
function isWithinGalleryHours(start, end) {
  const sMin = timeToMinutes(start);
  const eMin = timeToMinutes(end);
  return sMin >= OPEN_HOUR * 60 && eMin <= GALLERY_CLOSE_HOUR * 60 && sMin < eMin;
}

// 勤務時間（時間単位）を計算
function calcDurationHours(start, end) {
  const diff = timeToMinutes(end) - timeToMinutes(start);
  return Math.max(0, diff / 60);
}

// 10:00〜23:00 の選択肢を生成（30分刻み）
function generateTimeOptions() {
  const times = [];
  for (let h = OPEN_HOUR; h <= CLOSE_HOUR; h++) {
    const hh = String(h).padStart(2, "0");
    times.push(`${hh}:00`);
    if (h < CLOSE_HOUR) {
      times.push(`${hh}:30`);
    }
  }
  return times;
}

// 自動配属アルゴリズム（日付と名前・時間帯に応じて最適な部門を決定）
function decideAutoShop(dateStr, staffName, start, end, excludeShiftId = null) {
  const dayShifts = state.shifts.filter(
    (s) => s.date === dateStr && s.id !== excludeShiftId && s.shop
  );

  // 時間帯が重なるシフトをカウント
  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  const overlapping = dayShifts.filter((s) =>
    isTimeOverlapping(start, end, s.start, s.end)
  );

  const countByShop = {
    "Hoa Hoa": overlapping.filter((s) => s.shop === "Hoa Hoa").length,
    "guu table": overlapping.filter((s) => s.shop === "guu table").length,
    GALLERY: overlapping.filter((s) => s.shop === "GALLERY").length
  };

  // 同じ日にすでに本人が別部門に入っている場合（ヘルプ出勤）、同じ部門より別部門を優先
  const myOtherShifts = dayShifts.filter((s) => s.name === staffName);
  const alreadyInGallery = myOtherShifts.some((s) => s.shop === "GALLERY");

  // GALLERY対象者（塩沢・内山・岡村・大塚）かつ開始時間が19:00より前の場合
  if (isGalleryEligible(staffName) && startMin < GALLERY_CLOSE_HOUR * 60 && !alreadyInGallery) {
    // 19:00までに終わるシフトでGALLERYが0人なら最優先でGALLERYに配置
    if (endMin <= GALLERY_CLOSE_HOUR * 60) {
      if (countByShop["GALLERY"] === 0) {
        return "GALLERY";
      }
      const sorted = ["GALLERY", "Hoa Hoa", "guu table"].sort(
        (a, b) => countByShop[a] - countByShop[b]
      );
      return sorted[0];
    }
    // 終了希望が19:00以降でも、その日のGALLERYがまだ0人ならGALLERYに配置
    const dayGalleryCount = dayShifts.filter((s) => s.shop === "GALLERY").length;
    if (dayGalleryCount === 0) {
      return "GALLERY";
    }
  }

  // GALLERY対象外スタッフ、または19:00以降のシフト（ヘルプ出勤2枠目含む）は Hoa Hoa と guu table のうち人数が少ない方へ配置
  if (countByShop["Hoa Hoa"] <= countByShop["guu table"]) {
    return "Hoa Hoa";
  } else {
    return "guu table";
  }
}

// GALLERYに配属された場合、終了時間を19:00までに収める補正関数
function normalizeEndForShop(shop, start, end) {
  if (shop === "GALLERY" && timeToMinutes(end) > GALLERY_CLOSE_HOUR * 60) {
    return GALLERY_CLOSE_STR;
  }
  return end;
}

/**
 * 遅番不足時の調整ルール（希望日以外の勝手な追加は一切行わない）：
 * その日（dateStr）に「岡村・塩沢・大塚・内山」以外のスタッフ入力があり、
 * かつ夜時間帯（遅番）が不足している場合、
 * 【その日にすでにシフト希望を出している「岡村・内山・塩沢」】の中から1名の既存シフトを22:00までの店舗出勤に調整する。
 * ※その日に希望を出していないスタッフを勝手に追加したり、2枠目を勝手に増やしたりしない。
 */
function ensureLateShiftSupportForDate(dateStr) {
  const dayShifts = state.shifts.filter((s) => s.date === dateStr);
  // その日に4名以外のスタッフ入力があるか確認
  const hasOtherStaffOnDay = dayShifts.some((s) => !isGalleryEligible(s.name));
  if (!hasOtherStaffOnDay) {
    return false;
  }

  // その日に21:30以降まで店舗（Hoa Hoa / guu table）に残っている遅番スタッフがいるか確認
  const hasLateWorkerOnDay = dayShifts.some(
    (s) =>
      s.shop !== "GALLERY" &&
      timeToMinutes(s.end) >= 21 * 60 + 30
  );
  if (hasLateWorkerOnDay) {
    return false; // すでに遅番がいるため調整不要
  }

  // その日にすでに希望を出して登録されている「岡村・内山・塩沢」のシフトを探す（※希望日以外の勝手な追加はしない）
  // 1. まず店舗（Hoa Hoa / guu table）に配属されている岡村・内山・塩沢がいれば、そのシフトの終了を22:00に調整
  const eligibleStoreShifts = dayShifts.filter(
    (s) =>
      isLateSupportEligible(s.name) &&
      s.shop !== "GALLERY" &&
      timeToMinutes(s.end) < LATE_SUPPORT_END_MIN
  );
  if (eligibleStoreShifts.length > 0) {
    eligibleStoreShifts[0].end = LATE_SUPPORT_END_STR;
    eligibleStoreShifts[0].isLateSupport = true;
    return true;
  }

  // 2. もしAUTO指定でGALLERYに複数人入っている場合など、その日に希望を出している「岡村・内山・塩沢」がいれば、
  // 不足している店舗（Hoa Hoa または guu table）の22:00までのシフトへ振り返る（枠数は増やさない）
  const eligibleAutoShifts = dayShifts.filter(
    (s) =>
      isLateSupportEligible(s.name) &&
      (s.requestedShop === "AUTO" || !s.requestedShop)
  );
  if (eligibleAutoShifts.length > 0) {
    // GALLERYが0人にならない範囲、または複数いる場合は1名を店舗22:00までに調整
    const galleryShifts = dayShifts.filter((s) => s.shop === "GALLERY");
    const target =
      eligibleAutoShifts.find((s) => s.shop !== "GALLERY") ||
      (galleryShifts.length >= 2 ? eligibleAutoShifts[0] : null);

    if (target) {
      const hoaCount = dayShifts.filter((s) => s.shop === "Hoa Hoa").length;
      const guuCount = dayShifts.filter((s) => s.shop === "guu table").length;
      target.shop = hoaCount <= guuCount ? "Hoa Hoa" : "guu table";
      target.end = LATE_SUPPORT_END_STR;
      target.isLateSupport = true;
      return true;
    }
  }

  return false;
}

// 専用URL（トークン付きURL）のアクセス権限チェック
function checkAccessGate() {
  const params = new URLSearchParams(window.location.search);
  const urlKey = params.get("key");
  const savedKey = localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  const isLocal =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  if (urlKey === SHARED_ACCESS_KEY) {
    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, SHARED_ACCESS_KEY);
    return true;
  }

  if (isLocal) {
    // 管理者ローカル環境では自動的に専用URLパラメータを付与して許可
    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, SHARED_ACCESS_KEY);
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("key", SHARED_ACCESS_KEY);
    window.history.replaceState({}, "", newUrl.toString());
    return true;
  }

  if (savedKey === SHARED_ACCESS_KEY) {
    // 一度専用URLからアクセス済みの端末はそのまま利用可能＆URLにもトークンを復元
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("key", SHARED_ACCESS_KEY);
    window.history.replaceState({}, "", newUrl.toString());
    return true;
  }

  // 専用URL以外からのアクセスをブロック
  const overlay = document.getElementById("accessGateOverlay");
  if (overlay) overlay.classList.remove("hidden");
  return false;
}

// LINE共有用の専用URLを取得
function getShareableUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("key", SHARED_ACCESS_KEY);
  return url.toString();
}

// ローカルストレージ保存＆共有サーバー保存
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.shifts));
  saveToServer();
}

async function saveToServer() {
  try {
    const res = await fetch(`/api/shifts?key=${encodeURIComponent(SHARED_ACCESS_KEY)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-access-key": SHARED_ACCESS_KEY
      },
      body: JSON.stringify({ shifts: state.shifts })
    });
    if (res.ok) {
      updateSyncStatusBadge(true);
    }
  } catch (e) {
    // 静的ホスティングのみの場合などはローカル保存のみで動作
  }
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      state.shifts = JSON.parse(saved);
      normalizeLoadedShifts(state.shifts);
    } catch (e) {
      state.shifts = [];
    }
  }
}

function normalizeLoadedShifts(shiftsArray) {
  if (!Array.isArray(shiftsArray)) return;
  shiftsArray.forEach((s) => {
    if (s.shop === "GALLERY" && timeToMinutes(s.end) > GALLERY_CLOSE_HOUR * 60) {
      s.end = GALLERY_CLOSE_STR;
    }
  });
}

async function syncFromServer(isInitial = false) {
  try {
    const res = await fetch(`/api/shifts?key=${encodeURIComponent(SHARED_ACCESS_KEY)}`, {
      headers: { "x-access-key": SHARED_ACCESS_KEY },
      cache: "no-store"
    });
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.shifts)) {
      updateSyncStatusBadge(true);
      // 初回起動時、サーバー側が空で手元のブラウザにデータがある場合はサーバーへ初期アップロード
      if (isInitial && data.shifts.length === 0 && state.shifts.length > 0) {
        await saveToServer();
        return;
      }
      const serverJson = JSON.stringify(data.shifts);
      const currentJson = JSON.stringify(state.shifts);
      if (serverJson !== currentJson) {
        state.shifts = data.shifts;
        normalizeLoadedShifts(state.shifts);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.shifts));
        renderAll();
      }
    }
  } catch (e) {
    // サーバーAPIがない環境ではスキップ
  }
}

function updateSyncStatusBadge(isServerConnected) {
  const badge = document.getElementById("syncStatusBadge");
  if (!badge) return;
  if (isServerConnected) {
    badge.textContent = "🟢 共有URL限定・リアルタイム同期中";
  } else {
    badge.textContent = "🔒 専用URL限定";
  }
}

// サンプル希望データの投入（ボタン押下時のみ投入）
function seedSampleShifts(monthStr, showNotification = true) {
  const [year, month] = monthStr.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();

  // 当月の既存データをクリアしてサンプルを作成
  state.shifts = state.shifts.filter((s) => !s.date.startsWith(monthStr));

  const samplePatterns = [
    { name: "塩沢", start: "10:00", end: "18:00", daysMod: [1, 3, 5, 0] },
    { name: "内山", start: "10:00", end: "19:00", daysMod: [2, 4, 6] },
    { name: "岡村", start: "11:00", end: "18:00", daysMod: [1, 4, 0] },
    { name: "大塚", start: "10:00", end: "19:00", daysMod: [2, 5, 6] },
    { name: "佐藤", start: "10:00", end: "17:00", daysMod: [1, 2, 3, 4, 5] },
    { name: "鈴木", start: "11:00", end: "18:00", daysMod: [1, 3, 5, 6, 0] }
  ];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${monthStr}-${String(d).padStart(2, "0")}`;
    const dayOfWeek = new Date(year, month - 1, d).getDay();

    samplePatterns.forEach((pat) => {
      if (pat.daysMod.includes(dayOfWeek)) {
        const assignedShop = decideAutoShop(dateStr, pat.name, pat.start, pat.end);
        const finalEnd = normalizeEndForShop(assignedShop, pat.start, pat.end);
        state.shifts.push({
          id: `shift_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          date: dateStr,
          name: pat.name,
          start: pat.start,
          end: finalEnd,
          shop: assignedShop,
          requestedShop: "AUTO",
          isLateSupport: false
        });
      }
    });

    ensureLateShiftSupportForDate(dateStr);
  }

  saveState();
  renderAll();
  if (showNotification) {
    showToast(`${monthStr} のサンプル希望データを投入しました`);
  }
}

// 初期化処理
document.addEventListener("DOMContentLoaded", async () => {
  if (!checkAccessGate()) {
    return;
  }
  initTimeSelects();
  initControls();
  loadState();
  syncMonthDefaults();
  renderAll();

  // サーバー上の共有データと同期（初回＋10秒おき＋画面復帰時）
  await syncFromServer(true);
  setInterval(() => syncFromServer(false), 10000);
  window.addEventListener("focus", () => syncFromServer(false));
});

function initTimeSelects() {
  const options = generateTimeOptions();
  const startSelects = [
    document.getElementById("startTimeSelect"),
    document.getElementById("startTimeSelect2"),
    document.getElementById("editStartSelect")
  ];
  const endSelects = [
    document.getElementById("endTimeSelect"),
    document.getElementById("endTimeSelect2"),
    document.getElementById("editEndSelect")
  ];

  startSelects.forEach((sel) => {
    if (!sel) return;
    sel.innerHTML = options
      .slice(0, -1)
      .map((t) => `<option value="${t}">${t}</option>`)
      .join("");
    sel.value = "10:00";
  });

  endSelects.forEach((sel) => {
    if (!sel) return;
    sel.innerHTML = options
      .slice(1)
      .map((t) => `<option value="${t}">${t}</option>`)
      .join("");
    sel.value = "18:00";
  });

  // 2枠目のデフォルト時間は 18:00〜22:00
  const s2 = document.getElementById("startTimeSelect2");
  const e2 = document.getElementById("endTimeSelect2");
  if (s2) s2.value = "18:00";
  if (e2) e2.value = "22:00";
}

function syncMonthDefaults() {
  const monthInput = document.getElementById("targetMonthInput");
  monthInput.value = state.currentMonth;

  const defaultDate = `${state.currentMonth}-01`;
  document.getElementById("shiftDateInput").value = defaultDate;
  state.selectedDailyDate = defaultDate;
  document.getElementById("dailyDateSelect").value = defaultDate;

  renderMultiDateSelector();
}

function initControls() {
  // 月変更
  const monthInput = document.getElementById("targetMonthInput");
  monthInput.addEventListener("change", (e) => {
    if (e.target.value) {
      state.currentMonth = e.target.value;
      syncMonthDefaults();
      renderAll();
    }
  });

  document.getElementById("prevMonthBtn").addEventListener("click", () => {
    changeMonthBy(-1);
  });
  document.getElementById("nextMonthBtn").addEventListener("click", () => {
    changeMonthBy(1);
  });

  // LINE共有用URLをコピー
  document.getElementById("copyShareUrlBtn")?.addEventListener("click", async () => {
    const shareUrl = getShareableUrl();
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast("🔗 LINE共有用の専用URLをコピーしました！そのままLINEに貼り付けて共有できます");
    } catch (e) {
      prompt("以下の専用URLをコピーしてLINE等で共有してください：", shareUrl);
    }
  });

  // 印刷
  document.getElementById("printBtn")?.addEventListener("click", () => window.print());

  // スタッフ名入力時のGALLERY可否チェック
  const staffNameInput = document.getElementById("staffNameInput");
  staffNameInput.addEventListener("input", () => {
    updateGalleryEligibilityUI(staffNameInput.value);
  });

  // クイック名前チップ
  document.querySelectorAll(".name-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      staffNameInput.value = chip.dataset.name;
      updateGalleryEligibilityUI(chip.dataset.name);
    });
  });

  // 定型時間チップ
  document.querySelectorAll(".time-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.getElementById("startTimeSelect").value = chip.dataset.start;
      document.getElementById("endTimeSelect").value = chip.dataset.end;
    });
  });

  // 2枠目チェックボックス切替
  const enableSecondCheck = document.getElementById("enableSecondShiftCheck");
  const secondShiftBox = document.getElementById("secondShiftBox");
  enableSecondCheck.addEventListener("change", () => {
    secondShiftBox.classList.toggle("hidden", !enableSecondCheck.checked);
    if (state.inputMode === "multi") {
      renderMultiDateTimeList();
    }
  });

  // 単日・複数日切替タブ
  document.querySelectorAll(".mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".mode-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.inputMode = tab.dataset.mode;

      const singleBox = document.getElementById("singleDateBox");
      const multiBox = document.getElementById("multiDateBox");
      const dateInput = document.getElementById("shiftDateInput");

      if (state.inputMode === "single") {
        singleBox.classList.remove("hidden");
        multiBox.classList.add("hidden");
        dateInput.required = true;
      } else {
        singleBox.classList.add("hidden");
        multiBox.classList.remove("hidden");
        dateInput.required = false;
        renderMultiDateSelector();
      }
    });
  });

  // 複数日一括選択ボタン
  document.querySelectorAll(".weekday-Select-bar button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.weekday.trim();
      const [year, month] = state.currentMonth.split("-").map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();

      if (mode === "clear") {
        state.selectedMultiDates.clear();
      } else {
        for (let d = 1; d <= daysInMonth; d++) {
          const dateStr = `${state.currentMonth}-${String(d).padStart(2, "0")}`;
          const dow = new Date(year, month - 1, d).getDay();
          if (mode === "all") {
            state.selectedMultiDates.add(dateStr);
            ensureMultiDateTimeEntry(dateStr);
          }
          if (mode === "weekdays" && dow >= 1 && dow <= 5) {
            state.selectedMultiDates.add(dateStr);
            ensureMultiDateTimeEntry(dateStr);
          }
          if (mode === "weekends" && (dow === 0 || dow === 6)) {
            state.selectedMultiDates.add(dateStr);
            ensureMultiDateTimeEntry(dateStr);
          }
        }
      }
      renderMultiDateSelector();
    });
  });

  // 複数日選択時：「基本時間で揃える」ボタン
  const applyBaseBtn = document.getElementById("applyBaseTimeToAllBtn");
  if (applyBaseBtn) {
    applyBaseBtn.addEventListener("click", () => {
      const baseStart1 = document.getElementById("startTimeSelect").value;
      const baseEnd1 = document.getElementById("endTimeSelect").value;
      const baseStart2 = document.getElementById("startTimeSelect2").value;
      const baseEnd2 = document.getElementById("endTimeSelect2").value;
      state.selectedMultiDates.forEach((dt) => {
        state.multiDateTimes[dt] = {
          start1: baseStart1,
          end1: baseEnd1,
          start2: baseStart2,
          end2: baseEnd2
        };
      });
      renderMultiDateTimeList();
      showToast("選択中のすべての日付に基本時間を反映しました");
    });
  }

  // シフト希望登録フォーム送信
  document.getElementById("shiftRequestForm").addEventListener("submit", handleAddShiftSubmit);

  // 配属先でGALLERYを選択した際、終了時間が19:00を超えていたら自動で19:00に合わせる
  document.getElementById("preferredShopSelect").addEventListener("change", (e) => {
    if (e.target.value === "GALLERY") {
      const startSel = document.getElementById("startTimeSelect");
      const endSel = document.getElementById("endTimeSelect");
      if (timeToMinutes(startSel.value) >= GALLERY_CLOSE_HOUR * 60) {
        startSel.value = "10:00";
      }
      if (timeToMinutes(endSel.value) > GALLERY_CLOSE_HOUR * 60) {
        endSel.value = GALLERY_CLOSE_STR;
        showToast("GALLERYの営業時間（10:00〜19:00）に合わせて終了時間を19:00に調整しました");
      }
    }
  });

  document.getElementById("preferredShopSelect2").addEventListener("change", (e) => {
    if (e.target.value === "GALLERY") {
      const startSel = document.getElementById("startTimeSelect2");
      const endSel = document.getElementById("endTimeSelect2");
      if (timeToMinutes(startSel.value) >= GALLERY_CLOSE_HOUR * 60) {
        startSel.value = "10:00";
      }
      if (timeToMinutes(endSel.value) > GALLERY_CLOSE_HOUR * 60) {
        endSel.value = GALLERY_CLOSE_STR;
        showToast("GALLERYの営業時間（10:00〜19:00）に合わせて2枠目の終了時間を19:00に調整しました");
      }
    }
  });

  // 全データ削除
  document.getElementById("clearAllDataBtn").addEventListener("click", () => {
    if (confirm(`${state.currentMonth} のシフトデータをすべて消去しますか？`)) {
      state.shifts = state.shifts.filter((s) => !s.date.startsWith(state.currentMonth));
      saveState();
      renderAll();
      showToast("対象月のシフトデータを初期化しました");
    }
  });

  // 表示ビュー切替タブ
  document.querySelectorAll(".view-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".view-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.currentView = tab.dataset.view;
      updateViewVisibility();
      renderAll();
    });
  });

  // スマホ用カレンダー表示切替（縦リスト / 7列カレンダー）
  document.querySelectorAll(".mobile-cal-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mobile-cal-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const wrapper = document.getElementById("calendarScrollWrapper");
      if (wrapper) {
        const mode = btn.dataset.calMode;
        wrapper.classList.toggle("mobile-list-mode", mode === "list");
        wrapper.classList.toggle("mobile-grid-mode", mode === "grid");
      }
    });
  });

  // 店舗フィルタ
  document.getElementById("shopFilterSelect").addEventListener("change", (e) => {
    state.shopFilter = e.target.value;
    renderAll();
  });

  // 日別タイムライン日付変更
  document.getElementById("dailyDateSelect").addEventListener("change", (e) => {
    state.selectedDailyDate = e.target.value;
    renderDailyTimeline();
  });

  // モーダル制御
  document.getElementById("closeModalBtn").addEventListener("click", closeEditModal);
  document.getElementById("cancelModalBtn").addEventListener("click", closeEditModal);
  document.getElementById("editShiftForm").addEventListener("submit", handleEditShiftSubmit);
  document.getElementById("deleteShiftBtn").addEventListener("click", handleDeleteShift);
}

function changeMonthBy(delta) {
  const [y, m] = state.currentMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  state.currentMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  state.selectedMultiDates.clear();
  syncMonthDefaults();
  renderAll();
}

// スタッフ名に応じたGALLERY可否＆遅番22時補充対象UIの更新
function updateGalleryEligibilityUI(nameValue) {
  const badge = document.getElementById("galleryEligibilityBadge");
  const galleryOpt = document.getElementById("galleryOption");
  const galleryOpt2 = document.getElementById("galleryOption2");
  const preferredSelect = document.getElementById("preferredShopSelect");
  const preferredSelect2 = document.getElementById("preferredShopSelect2");

  const trimmed = nameValue.trim();
  if (!trimmed) {
    badge.classList.add("hidden");
    galleryOpt.disabled = false;
    if (galleryOpt2) galleryOpt2.disabled = false;
    return;
  }

  const eligible = isGalleryEligible(trimmed);
  const lateEligible = isLateSupportEligible(trimmed);
  badge.classList.remove("hidden");

  if (eligible) {
    badge.className = "eligibility-badge ok";
    const lateNote = lateEligible
      ? "（遅番不足時の22:00補充・ヘルプ出勤対象）"
      : "（※GALLERY可・遅番22時自動補充対象外）";
    badge.textContent = `✓ ${trimmed} さんは「GALLERY(10-19)」「Hoa Hoa」「guu table」勤務可 ${lateNote}`;
    galleryOpt.disabled = false;
    if (galleryOpt2) galleryOpt2.disabled = false;
  } else {
    badge.className = "eligibility-badge no";
    badge.textContent = `ℹ️ ${trimmed} さんは「Hoa Hoa」「guu table」へ配属されます（遅番不足時は岡村・内山・塩沢が22:00まで補充）`;
    galleryOpt.disabled = true;
    if (galleryOpt2) galleryOpt2.disabled = true;
    if (preferredSelect.value === "GALLERY") preferredSelect.value = "AUTO";
    if (preferredSelect2 && preferredSelect2.value === "GALLERY") preferredSelect2.value = "Hoa Hoa";
  }
}

// 複数日選択時の日付別デフォルト時間エントリ初期化
function ensureMultiDateTimeEntry(dateStr) {
  if (!state.multiDateTimes[dateStr]) {
    const start1 = document.getElementById("startTimeSelect")?.value || "10:00";
    const end1 = document.getElementById("endTimeSelect")?.value || "18:00";
    const start2 = document.getElementById("startTimeSelect2")?.value || "18:00";
    const end2 = document.getElementById("endTimeSelect2")?.value || "22:00";
    state.multiDateTimes[dateStr] = { start1, end1, start2, end2 };
  }
}

// 複数日グリッドの描画
function renderMultiDateSelector() {
  const container = document.getElementById("multiDateGrid");
  const [year, month] = state.currentMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const weekNames = ["日", "月", "火", "水", "木", "金", "土"];

  let html = "";
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${state.currentMonth}-${String(d).padStart(2, "0")}`;
    const dow = new Date(year, month - 1, d).getDay();
    const isSelected = state.selectedMultiDates.has(dateStr);
    html += `
      <div class="day-check-item ${isSelected ? "selected" : ""}" data-date="${dateStr}">
        <span>${d}日</span>
        <small>(${weekNames[dow]})</small>
      </div>
    `;
  }
  container.innerHTML = html;

  container.querySelectorAll(".day-check-item").forEach((el) => {
    el.addEventListener("click", () => {
      const dt = el.dataset.date;
      if (state.selectedMultiDates.has(dt)) {
        state.selectedMultiDates.delete(dt);
      } else {
        state.selectedMultiDates.add(dt);
        ensureMultiDateTimeEntry(dt);
      }
      renderMultiDateSelector();
    });
  });

  renderMultiDateTimeList();
}

// 複数日選択時：選択した日にちごとの個別時間変更リストを描画
function renderMultiDateTimeList() {
  const section = document.getElementById("multiDateTimeSection");
  const listEl = document.getElementById("multiDateTimeList");
  if (!section || !listEl) return;

  const selectedDates = Array.from(state.selectedMultiDates).sort();
  if (selectedDates.length === 0) {
    section.classList.add("hidden");
    listEl.innerHTML = "";
    return;
  }

  section.classList.remove("hidden");
  const options = generateTimeOptions();
  const startOptions = options.slice(0, -1);
  const endOptions = options.slice(1);
  const weekNames = ["日", "月", "火", "水", "木", "金", "土"];
  const useSecondSlot = document.getElementById("enableSecondShiftCheck")?.checked;

  let html = "";
  selectedDates.forEach((dateStr) => {
    ensureMultiDateTimeEntry(dateStr);
    const entry = state.multiDateTimes[dateStr];
    const [y, m, d] = dateStr.split("-").map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const dateLabel = `${m}/${d}(${weekNames[dow]})`;

    const buildSelect = (opts, selectedVal, fieldName) =>
      `<select class="multi-time-select" data-date="${dateStr}" data-field="${fieldName}">` +
      opts
        .map(
          (t) => `<option value="${t}" ${t === selectedVal ? "selected" : ""}>${t}</option>`
        )
        .join("") +
      `</select>`;

    html += `
      <div class="multi-date-time-row">
        <div class="multi-row-line">
          <span class="multi-row-date">${dateLabel}</span>
          <div class="multi-row-selects">
            ${buildSelect(startOptions, entry.start1, "start1")}
            <span>〜</span>
            ${buildSelect(endOptions, entry.end1, "end1")}
          </div>
          <button type="button" class="multi-row-remove" data-remove-date="${dateStr}" title="この日の選択を解除">×</button>
        </div>
        ${
          useSecondSlot
            ? `
          <div class="multi-row-line">
            <span class="multi-row-date" style="font-size:10px;color:#0369a1;">└ 2枠目</span>
            <div class="multi-row-selects">
              ${buildSelect(startOptions, entry.start2, "start2")}
              <span>〜</span>
              ${buildSelect(endOptions, entry.end2, "end2")}
            </div>
            <span style="width:20px;"></span>
          </div>
        `
            : ""
        }
      </div>
    `;
  });

  listEl.innerHTML = html;

  // 時間変更イベント
  listEl.querySelectorAll(".multi-time-select").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      const dt = e.target.dataset.date;
      const field = e.target.dataset.field;
      if (state.multiDateTimes[dt]) {
        state.multiDateTimes[dt][field] = e.target.value;
      }
    });
  });

  // 個別解除ボタン
  listEl.querySelectorAll(".multi-row-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dt = btn.dataset.removeDate;
      state.selectedMultiDates.delete(dt);
      renderMultiDateSelector();
    });
  });
}

// シフト希望追加（単日＆複数日の日付別時間指定＆同日2枠ヘルプ出勤＆遅番不足時の22:00調整対応）
function handleAddShiftSubmit(e) {
  e.preventDefault();
  const name = document.getElementById("staffNameInput").value.trim();
  const baseStart1 = document.getElementById("startTimeSelect").value;
  const baseEnd1 = document.getElementById("endTimeSelect").value;
  const prefShop1 = document.getElementById("preferredShopSelect").value;

  const useSecondSlot = document.getElementById("enableSecondShiftCheck").checked;
  const baseStart2 = document.getElementById("startTimeSelect2").value;
  const baseEnd2 = document.getElementById("endTimeSelect2").value;
  const prefShop2 = document.getElementById("preferredShopSelect2").value;

  if (!name) {
    showToast("スタッフ名を入力してください");
    return;
  }

  // 対象日付リストの取得
  let targetDates = [];
  if (state.inputMode === "single") {
    const singleDate = document.getElementById("shiftDateInput").value;
    if (!singleDate) {
      showToast("希望日を選択してください");
      return;
    }
    targetDates = [singleDate];
  } else {
    targetDates = Array.from(state.selectedMultiDates).sort();
    if (targetDates.length === 0) {
      showToast("対象の日付を1日以上選択してください");
      return;
    }
  }

  // 日付ごとのスロット構成を作成して事前バリデーション
  const slotsByDate = {};
  for (const dateStr of targetDates) {
    let s1 = baseStart1;
    let e1 = baseEnd1;
    let s2 = baseStart2;
    let e2 = baseEnd2;

    if (state.inputMode === "multi" && state.multiDateTimes[dateStr]) {
      s1 = state.multiDateTimes[dateStr].start1;
      e1 = state.multiDateTimes[dateStr].end1;
      s2 = state.multiDateTimes[dateStr].start2;
      e2 = state.multiDateTimes[dateStr].end2;
    }

    const daySlots = [{ start: s1, end: e1, prefShop: prefShop1 }];
    if (useSecondSlot) {
      daySlots.push({ start: s2, end: e2, prefShop: prefShop2 });
    }

    for (let i = 0; i < daySlots.length; i++) {
      const sl = daySlots[i];
      const label = `${dateStr}${daySlots.length > 1 ? ` 第${i + 1}シフト` : ""}：`;
      if (timeToMinutes(sl.start) >= timeToMinutes(sl.end)) {
        showToast(`${label}終了時間は開始時間より後に設定してください`);
        return;
      }
      if (sl.prefShop === "GALLERY") {
        if (!isGalleryEligible(name)) {
          showToast(`${label}GALLERYの勤務は「塩沢・内山・岡村・大塚」の4名のみ可能です`);
          return;
        }
        if (!isWithinGalleryHours(sl.start, sl.end)) {
          showToast(`${label}GALLERYの営業時間は 10:00〜19:00 です`);
          return;
        }
      }
    }

    if (daySlots.length === 2) {
      if (isTimeOverlapping(daySlots[0].start, daySlots[0].end, daySlots[1].start, daySlots[1].end)) {
        showToast(`${dateStr}：第1シフトと第2シフトの時間が重なっています`);
        return;
      }
    }

    slotsByDate[dateStr] = daySlots;
  }

  let addedDatesCount = 0;
  let supportTriggeredCount = 0;

  for (const dateStr of targetDates) {
    const slotsToAdd = slotsByDate[dateStr];

    if (slotsToAdd.length === 2) {
      // 2枠同時指定時は、その日の本人の既存シフトをこの2枠で置き換える
      state.shifts = state.shifts.filter((s) => !(s.date === dateStr && s.name === name));
      slotsToAdd.forEach((sl) => {
        const finalShop =
          sl.prefShop === "AUTO"
            ? decideAutoShop(dateStr, name, sl.start, sl.end)
            : sl.prefShop;
        const finalEnd = normalizeEndForShop(finalShop, sl.start, sl.end);
        state.shifts.push({
          id: `shift_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          date: dateStr,
          name,
          start: sl.start,
          end: finalEnd,
          requestedEnd: sl.end,
          shop: finalShop,
          requestedShop: sl.prefShop,
          isLateSupport: false
        });
      });
      addedDatesCount++;
    } else {
      // 1枠指定時：
      // 既存シフトが0個 → そのまま1枠だけ追加
      // 既存シフトが1個 ＆ 時間が重ならない → 2つ目のシフトとして追加
      const sl = slotsToAdd[0];
      const finalShop =
        sl.prefShop === "AUTO"
          ? decideAutoShop(dateStr, name, sl.start, sl.end)
          : sl.prefShop;
      const finalEnd = normalizeEndForShop(finalShop, sl.start, sl.end);

      const currentManualShifts = state.shifts.filter(
        (s) => s.date === dateStr && s.name === name
      );

      if (currentManualShifts.length === 0) {
        state.shifts.push({
          id: `shift_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          date: dateStr,
          name,
          start: sl.start,
          end: finalEnd,
          requestedEnd: sl.end,
          shop: finalShop,
          requestedShop: sl.prefShop,
          isLateSupport: false
        });
        addedDatesCount++;
      } else if (currentManualShifts.length === 1) {
        const ex = currentManualShifts[0];
        if (!isTimeOverlapping(ex.start, ex.end, sl.start, finalEnd)) {
          // 時間が重ならないので2つ目のシフトとして追加
          state.shifts.push({
            id: `shift_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            date: dateStr,
            name,
            start: sl.start,
            end: finalEnd,
            requestedEnd: sl.end,
            shop: finalShop,
            requestedShop: sl.prefShop,
            isLateSupport: false
          });
          addedDatesCount++;
        } else {
          if (targetDates.length === 1) {
            showToast(
              `${dateStr} の ${name} さんは既に ${ex.start}〜${ex.end}(${ex.shop}) が登録されており時間が重なります。時間をずらすか、バッジをクリックして編集してください`
            );
            return;
          } else {
            // 複数日一括選択で同日1枠が既にある場合は時間を上書き更新
            ex.start = sl.start;
            ex.end = finalEnd;
            ex.requestedEnd = sl.end;
            ex.shop = finalShop;
            ex.requestedShop = sl.prefShop;
            addedDatesCount++;
          }
        }
      } else {
        if (targetDates.length === 1) {
          showToast(
            `${dateStr} の ${name} さんは既に2枠登録されています（1日最大2つまで）。変更する場合はカレンダー上のバッジをクリックしてください`
          );
          return;
        }
      }
    }

    // その日に4名以外のスタッフ入力があり遅番が不足している場合、その日に希望を出している岡村・内山・塩沢の時間を22:00までに調整
    if (ensureLateShiftSupportForDate(dateStr)) {
      supportTriggeredCount++;
    }
  }

  // 単日入力で別月を入れた場合、その月へ移動
  if (targetDates.length === 1) {
    const mPrefix = targetDates[0].slice(0, 7);
    if (mPrefix !== state.currentMonth) {
      state.currentMonth = mPrefix;
      document.getElementById("targetMonthInput").value = mPrefix;
    }
  }

  saveState();
  renderAll();

  if (supportTriggeredCount > 0) {
    showToast(
      `${name} さんのシフトを反映しました（当日の遅番不足により岡村・内山・塩沢の出勤時間を22:00までに調整）`
    );
  } else {
    showToast(`${name} さんのシフト（${addedDatesCount}日分）をカレンダー表へ反映しました`);
  }
}

// 当月のシフトを人数バランス・GALLERY制限・遅番不足時22:00調整ルールに基づいて一括再割り当て
function rebalanceCurrentMonthShifts() {
  const monthShifts = state.shifts.filter((s) => s.date.startsWith(state.currentMonth));
  if (monthShifts.length === 0) {
    showToast("対象月のシフトデータがありません");
    return;
  }

  const dates = [
    ...new Set(
      state.shifts
        .filter((s) => s.date.startsWith(state.currentMonth))
        .map((s) => s.date)
    )
  ].sort();

  dates.forEach((dateStr) => {
    const dayShifts = state.shifts.filter((s) => s.date === dateStr);
    // 元の希望終了時間があれば戻してから再判定
    dayShifts.forEach((s) => {
      if (s.requestedEnd) {
        s.end = s.requestedEnd;
      }
      s.isLateSupport = false;
    });

    // 1. GALLERY適格者かつ10:00〜19:00に収まるシフトを優先処理
    const sorted = [...dayShifts].sort((a, b) => {
      const aElig =
        isGalleryEligible(a.name) && timeToMinutes(a.start) < GALLERY_CLOSE_HOUR * 60 ? 0 : 1;
      const bElig =
        isGalleryEligible(b.name) && timeToMinutes(b.start) < GALLERY_CLOSE_HOUR * 60 ? 0 : 1;
      if (aElig !== bElig) return aElig - bElig;
      return timeToMinutes(a.start) - timeToMinutes(b.start);
    });

    sorted.forEach((s) => {
      if (!isGalleryEligible(s.name) && s.shop === "GALLERY") {
        s.requestedShop = "AUTO";
      }
      if (s.requestedShop === "AUTO" || !s.requestedShop) {
        s.shop = "";
      }
    });

    sorted.forEach((s) => {
      if (s.requestedShop && s.requestedShop !== "AUTO") {
        if (
          s.requestedShop === "GALLERY" &&
          (!isGalleryEligible(s.name) || timeToMinutes(s.start) >= GALLERY_CLOSE_HOUR * 60)
        ) {
          s.shop = decideAutoShop(dateStr, s.name, s.start, s.end, s.id);
        } else {
          s.shop = s.requestedShop;
        }
      } else {
        s.shop = decideAutoShop(dateStr, s.name, s.start, s.end, s.id);
      }
      s.end = normalizeEndForShop(s.shop, s.start, s.end);
    });

    // その日に希望を出しているスタッフの中で遅番不足があれば岡村・内山・塩沢を22:00までに調整
    ensureLateShiftSupportForDate(dateStr);
  });

  saveState();
  renderAll();
  showToast("登録されている希望日のシフトを再編成しました");
}

// 表示切替
function updateViewVisibility() {
  document.getElementById("calendarView").classList.toggle("hidden", state.currentView !== "calendar");
  document.getElementById("matrixView").classList.toggle("hidden", state.currentView !== "matrix");
  document.getElementById("dailyView").classList.toggle("hidden", state.currentView !== "daily");
}

// 全体再描画
function renderAll() {
  renderCalendar();
  renderMatrixTable();
  renderDailyTimeline();
  renderStaffSummary();
}

function getShopClass(shopName) {
  if (shopName === "Hoa Hoa") return "shop-hoahoa";
  if (shopName === "guu table") return "shop-guu";
  if (shopName === "GALLERY") return "shop-gallery";
  return "";
}

// 1. 月間カレンダー表の描画
function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  const [year, month] = state.currentMonth.split("-").map(Number);
  const firstDayDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const weekNames = ["日", "月", "火", "水", "木", "金", "土"];

  let html = "";

  // 月初の空白セル
  for (let i = 0; i < firstDayDow; i++) {
    html += `<div class="calendar-cell empty"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${state.currentMonth}-${String(d).padStart(2, "0")}`;
    const dow = new Date(year, month - 1, d).getDay();
    const dowClass = dow === 0 ? "sun" : dow === 6 ? "sat" : "";

    const allDayShifts = state.shifts.filter((s) => s.date === dateStr);

    let dayShifts = allDayShifts
      .filter((s) => state.shopFilter === "ALL" || s.shop === state.shopFilter)
      .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

    const shiftBadges = dayShifts
      .map((s) => {
        const shopCls = getShopClass(s.shop);
        return `
          <div class="shift-item ${shopCls}" data-shift-id="${s.id}" title="クリックして編集・削除">
            <div class="shift-item-top">
              <span>${escapeHtml(s.name)}</span>
              <span class="shift-shop-tag">${escapeHtml(s.shop)}</span>
            </div>
            <div class="shift-time-text">${s.start} - ${s.end}</div>
          </div>
        `;
      })
      .join("");

    html += `
      <div class="calendar-cell ${dayShifts.length === 0 ? "no-shifts" : ""}" data-date="${dateStr}">
        <div class="cell-header">
          <span class="day-number ${dowClass}" data-jump-date="${dateStr}" title="日別タイムラインを見る">${d}日 <small class="mobile-dow">(${weekNames[dow]})</small></span>
          <button type="button" class="add-day-btn" data-add-date="${dateStr}" title="${dateStr} にシフトを追加">＋</button>
        </div>
        <div class="cell-shifts">
          ${shiftBadges}
        </div>
      </div>
    `;
  }

  grid.innerHTML = html;

  // シフトクリックで編集モーダル起動
  grid.querySelectorAll(".shift-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditModal(item.dataset.shiftId);
    });
  });

  // 「＋」ボタンで左フォームの日付をセットしてフォーカス
  grid.querySelectorAll(".add-day-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dt = btn.dataset.addDate;
      document.querySelector('.mode-tab[data-mode="single"]').click();
      document.getElementById("shiftDateInput").value = dt;
      const inputPanel = document.querySelector(".input-panel");
      if (inputPanel && window.innerWidth <= 900) {
        inputPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      document.getElementById("staffNameInput").focus();
      showToast(`入力フォームの日付を ${dt} にセットしました`);
    });
  });

  // 日付数字クリックで日別タイムラインへジャンプ
  grid.querySelectorAll(".day-number").forEach((num) => {
    num.addEventListener("click", () => {
      state.selectedDailyDate = num.dataset.jumpDate;
      document.getElementById("dailyDateSelect").value = state.selectedDailyDate;
      document.querySelector('.view-tab[data-view="daily"]').click();
    });
  });
}

// 2. スタッフ×日付マトリクス早見表の描画
function renderMatrixTable() {
  const table = document.getElementById("matrixTable");
  const [year, month] = state.currentMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const weekNames = ["日", "月", "火", "水", "木", "金", "土"];

  const monthShifts = state.shifts.filter(
    (s) =>
      s.date.startsWith(state.currentMonth) &&
      (state.shopFilter === "ALL" || s.shop === state.shopFilter)
  );

  // スタッフ一覧（GALLERYメンバーを上位に表示）
  const staffNames = [...new Set(monthShifts.map((s) => s.name))].sort((a, b) => {
    const aElig = isGalleryEligible(a) ? 0 : 1;
    const bElig = isGalleryEligible(b) ? 0 : 1;
    if (aElig !== bElig) return aElig - bElig;
    return a.localeCompare(b, "ja");
  });

  let thead = `<thead><tr><th class="sticky-col">スタッフ名 ＼ 日付</th>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    const colorStyle =
      dow === 0 ? "color:#dc2626;" : dow === 6 ? "color:#2563eb;" : "";
    thead += `<th style="${colorStyle}">${d}<br/><small>${weekNames[dow]}</small></th>`;
  }
  thead += `<th>月間日数</th><th>月間時間</th></tr></thead>`;

  let tbody = "<tbody>";
  if (staffNames.length === 0) {
    tbody += `<tr><td colspan="${daysInMonth + 3}" style="padding:24px;">表示できるシフトデータがありません</td></tr>`;
  } else {
    staffNames.forEach((name) => {
      const eligBadge = isGalleryEligible(name)
        ? `<span class="gallery-star" title="GALLERY勤務可">★G可</span>`
        : "";
      let totalDays = 0;
      let totalHours = 0;

      tbody += `<tr><td class="sticky-col">${escapeHtml(name)} ${eligBadge}</td>`;

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${state.currentMonth}-${String(d).padStart(2, "0")}`;
        const cellShifts = monthShifts
          .filter((s) => s.date === dateStr && s.name === name)
          .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

        if (cellShifts.length === 0) {
          tbody += `<td>-</td>`;
        } else {
          // 同日に2枠（ヘルプ出勤）入っていても出勤日数は1日としてカウント
          totalDays += 1;
          const badgesHtml = cellShifts
            .map((s) => {
              totalHours += calcDurationHours(s.start, s.end);
              const cls = getShopClass(s.shop);
              const shortShop =
                s.shop === "Hoa Hoa" ? "Hoa" : s.shop === "guu table" ? "guu" : "GAL";
              return `
                <div class="matrix-badge ${cls}" data-shift-id="${s.id}" style="margin-bottom:2px;">
                  <strong>${shortShop}</strong><br/>
                  ${s.start.replace(":00", "")}-${s.end.replace(":00", "")}
                </div>
              `;
            })
            .join("");
          tbody += `<td>${badgesHtml}</td>`;
        }
      }

      tbody += `<td><strong>${totalDays}日</strong></td><td><strong>${totalHours.toFixed(1)}h</strong></td></tr>`;
    });
  }
  tbody += "</tbody>";

  table.innerHTML = thead + tbody;

  table.querySelectorAll(".matrix-badge").forEach((badge) => {
    badge.addEventListener("click", () => {
      openEditModal(badge.dataset.shiftId);
    });
  });
}

// 3. 日別タイムライン（10:00〜23:00）の描画
function renderDailyTimeline() {
  const container = document.getElementById("dailyTimelineContainer");
  const statsText = document.getElementById("dailyStatsText");
  const dateStr = state.selectedDailyDate || `${state.currentMonth}-01`;

  const dayShifts = state.shifts
    .filter((s) => s.date === dateStr)
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

  statsText.textContent = `${dateStr} のシフト枠合計：${dayShifts.length}枠（Hoa Hoa・guu table 10:00-23:00 / GALLERY 10:00-19:00）`;

  const hours = [];
  for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
    hours.push(h);
  }

  let html = "";
  SHOPS.forEach((shopName) => {
    if (state.shopFilter !== "ALL" && state.shopFilter !== shopName) return;

    const shopShifts = dayShifts.filter((s) => s.shop === shopName);
    const shopCls = getShopClass(shopName);
    const activeCellCls =
      shopName === "Hoa Hoa"
        ? "active-hoahoa"
        : shopName === "guu table"
        ? "active-guu"
        : "active-gallery";

    const hoursLabel =
      shopName === "GALLERY"
        ? "10:00〜19:00 ※塩沢・内山・岡村・大塚のみ"
        : "10:00〜23:00";

    html += `
      <div class="shop-timeline-block">
        <div class="shop-timeline-title ${shopCls}">
          ${escapeHtml(shopName)} （配置：${shopShifts.length}名）
          <small>【営業時間：${hoursLabel}】</small>
        </div>
        <table class="timeline-table">
          <thead>
            <tr>
              <th style="width:150px;">スタッフ名</th>
              <th style="width:110px;">勤務時間</th>
              ${hours
                .map((h) => {
                  const isClosed = shopName === "GALLERY" && h >= GALLERY_CLOSE_HOUR;
                  return `<th class="${isClosed ? "timeline-closed-th" : ""}">${h}:00${isClosed ? "<br/><small>営外</small>" : ""}</th>`;
                })
                .join("")}
            </tr>
          </thead>
          <tbody>
            ${
              shopShifts.length === 0
                ? `<tr><td colspan="${hours.length + 2}" style="color:#94a3b8;padding:12px;">この日の割り当てはありません</td></tr>`
                : shopShifts
                    .map((s) => {
                      const sMin = timeToMinutes(s.start);
                      const eMin = timeToMinutes(s.end);
                      const cells = hours
                        .map((h) => {
                          if (shopName === "GALLERY" && h >= GALLERY_CLOSE_HOUR) {
                            return `<td class="timeline-closed-cell" title="GALLERY営業時間外（10:00-19:00）"></td>`;
                          }
                          const slotStart = h * 60;
                          const slotEnd = (h + 1) * 60;
                          const isWorking = sMin < slotEnd && eMin > slotStart;
                          return `<td class="${isWorking ? `timeline-bar-cell ${activeCellCls}` : ""}"></td>`;
                        })
                        .join("");
                      return `
                        <tr data-shift-id="${s.id}" style="cursor:pointer;" title="クリックして編集">
                          <td><strong>${escapeHtml(s.name)}</strong></td>
                          <td>${s.start} - ${s.end}</td>
                          ${cells}
                        </tr>
                      `;
                    })
                    .join("")
            }
          </tbody>
        </table>
      </div>
    `;
  });

  container.innerHTML = html;

  container.querySelectorAll("tr[data-shift-id]").forEach((row) => {
    row.addEventListener("click", () => {
      openEditModal(row.dataset.shiftId);
    });
  });
}

// 左パネル：スタッフ別月間集計リストの描画
function renderStaffSummary() {
  const listEl = document.getElementById("staffSummaryList");
  const monthShifts = state.shifts.filter((s) =>
    s.date.startsWith(state.currentMonth)
  );

  const summaryMap = new Map();
  monthShifts.forEach((s) => {
    if (!summaryMap.has(s.name)) {
      summaryMap.set(s.name, {
        datesSet: new Set(),
        hours: 0,
        shops: { "Hoa Hoa": 0, "guu table": 0, GALLERY: 0 }
      });
    }
    const item = summaryMap.get(s.name);
    item.datesSet.add(s.date);
    item.hours += calcDurationHours(s.start, s.end);
    item.shops[s.shop] = (item.shops[s.shop] || 0) + 1;
  });

  if (summaryMap.size === 0) {
    listEl.innerHTML = `<p style="font-size:12px;color:#64748b;">まだ当月のシフトがありません</p>`;
    return;
  }

  let html = "";
  Array.from(summaryMap.entries())
    .sort((a, b) => b[1].hours - a[1].hours)
    .forEach(([name, data]) => {
      const eligBadge = isLateSupportEligible(name)
        ? `<span class="gallery-star">GALLERY・遅番22時可</span>`
        : isGalleryEligible(name)
        ? `<span class="gallery-star">GALLERY可</span>`
        : "";
      html += `
        <div class="staff-summary-item">
          <div>
            <div class="staff-summary-name">
              ${escapeHtml(name)} ${eligBadge}
            </div>
            <div style="font-size:11px;color:#64748b;">
              枠数 Hoa:${data.shops["Hoa Hoa"]} / guu:${data.shops["guu table"]} / GAL:${data.shops["GALLERY"]}
            </div>
          </div>
          <div style="text-align:right;font-weight:700;">
            ${data.datesSet.size}日 (${data.hours.toFixed(1)}h)
          </div>
        </div>
      `;
    });

  listEl.innerHTML = html;
}

// シフト個別編集モーダル
function openEditModal(shiftId) {
  const shift = state.shifts.find((s) => s.id === shiftId);
  if (!shift) return;

  document.getElementById("editShiftId").value = shift.id;
  document.getElementById("editDateInput").value = shift.date;
  document.getElementById("editNameInput").value = shift.name;
  document.getElementById("editStartSelect").value = shift.start;
  document.getElementById("editEndSelect").value = shift.end;
  document.getElementById("editShopSelect").value = shift.shop;

  const warningEl = document.getElementById("editModalWarning");
  warningEl.classList.add("hidden");

  document.getElementById("editModal").classList.remove("hidden");
}

function closeEditModal() {
  document.getElementById("editModal").classList.add("hidden");
}

function handleEditShiftSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("editShiftId").value;
  const date = document.getElementById("editDateInput").value;
  const name = document.getElementById("editNameInput").value.trim();
  const start = document.getElementById("editStartSelect").value;
  const end = document.getElementById("editEndSelect").value;
  const shop = document.getElementById("editShopSelect").value;
  const warningEl = document.getElementById("editModalWarning");

  if (timeToMinutes(start) >= timeToMinutes(end)) {
    warningEl.textContent = "終了時間は開始時間より後に設定してください";
    warningEl.classList.remove("hidden");
    return;
  }

  // GALLERYの4名制限＆営業時間（10:00〜19:00）チェック
  if (shop === "GALLERY") {
    if (!isGalleryEligible(name)) {
      warningEl.textContent = `「GALLERY」は塩沢・内山・岡村・大塚の4名のみ割り当て可能です（${name}さんは不可）`;
      warningEl.classList.remove("hidden");
      return;
    }
    if (!isWithinGalleryHours(start, end)) {
      warningEl.textContent = "「GALLERY」の営業時間は 10:00〜19:00 です（19:00以降の時間は設定できません）";
      warningEl.classList.remove("hidden");
      return;
    }
  }

  // 同じ日・同じスタッフの他シフトと時間が重なっていないかチェック
  const otherShiftsSameDay = state.shifts.filter(
    (s) => s.date === date && s.name === name && s.id !== id
  );
  if (otherShiftsSameDay.length >= 2) {
    warningEl.textContent = "同じ日にすでに2つのシフトが登録されています（1日最大2つまで）";
    warningEl.classList.remove("hidden");
    return;
  }
  const overlappingShift = otherShiftsSameDay.find((s) =>
    isTimeOverlapping(s.start, s.end, start, end)
  );
  if (overlappingShift) {
    warningEl.textContent = `同日の別シフト（${overlappingShift.start}-${overlappingShift.end} ${overlappingShift.shop}）と時間が重なっています`;
    warningEl.classList.remove("hidden");
    return;
  }

  const idx = state.shifts.findIndex((s) => s.id === id);
  if (idx >= 0) {
    state.shifts[idx] = {
      ...state.shifts[idx],
      date,
      name,
      start,
      end,
      shop,
      requestedShop: shop,
      isLateSupport: false
    };
    saveState();
    renderAll();
    closeEditModal();
    showToast("シフトを更新しました");
  }
}

function handleDeleteShift() {
  const id = document.getElementById("editShiftId").value;
  state.shifts = state.shifts.filter((s) => s.id !== id);
  saveState();
  renderAll();
  closeEditModal();
  showToast("シフトを削除しました");
}

// CSV出力
function exportCsv() {
  const monthShifts = state.shifts
    .filter((s) => s.date.startsWith(state.currentMonth))
    .sort((a, b) => a.date.localeCompare(b.date) || timeToMinutes(a.start) - timeToMinutes(b.start));

  if (monthShifts.length === 0) {
    showToast("出力するシフトデータがありません");
    return;
  }

  const header = ["日付", "スタッフ名", "配属先", "開始時間", "終了時間", "勤務時間(h)", "備考"];
  const rows = monthShifts.map((s) => [
    s.date,
    s.name,
    s.shop,
    s.start,
    s.end,
    calcDurationHours(s.start, s.end).toFixed(1),
    s.isLateSupport ? "遅番不足補充(22:00まで)" : ""
  ]);

  const csvContent =
    "\uFEFF" +
    [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `シフト表_${state.currentMonth}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`シフト表_${state.currentMonth}.csv を出力しました`);
}

function showToast(msg) {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3500);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
