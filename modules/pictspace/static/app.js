const $ = (id) => document.getElementById(id);

const urlsEl = $("urls");
const groupsEl = $("groups");
const groupsMeta = $("groups-meta");
const analyzeHint = $("analyze-hint");
const startHint = $("start-hint");
const btnAnalyze = $("btn-analyze");
const btnStart = $("btn-start");
const btnPaste = $("btn-paste");
const jobBadge = $("job-badge");
const jobStatus = $("job-status");
const jobLog = $("job-log");
const btnContinue = $("btn-continue");
const btnCancel = $("btn-cancel");
const cartLink = $("cart-link");
const payLinksEl = $("pay-links");
const linksMeta = $("links-meta");
const dlLinksEl = $("dl-links");
const dlMeta = $("dl-meta");
const dlHint = $("dl-hint");
const btnScanDl = $("btn-scan-dl");
const btnToOrders = $("btn-to-orders");
const imapHint = $("imap-hint");
const btnImapTest = $("btn-imap-test");
const btnImapSave = $("btn-imap-save");

const PROFILE_KEY = "pictspace_guest_profile";
const FLOW_KEY = "pictspace_flow_v2";
const DEFAULT_EMAIL = "";

let pollTimer = null;
let orderScanTimer = null;
let orderScanBusy = false;
let lastPaymentCount = 0;
let lastAnalyzedText = "";
let analyzedGroups = [];
/** 已解锁到第几步（1-5），只能前进不能跳 */
let maxUnlocked = 1;
let currentStep = 1;
/** 用户已手动推进步骤时，禁止异步 initFlow 再把页面拨回去 */
let flowUserMoved = false;
/** 本机是否已有保存的授权码（输入框可能为空） */
let hasSavedAuth = false;

function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
    if (!p.email) p.email = DEFAULT_EMAIL;
    return p;
  } catch {
    return { email: DEFAULT_EMAIL };
  }
}

function saveProfile(p) {
  if (!p.email) p.email = DEFAULT_EMAIL;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

function readGuestForm() {
  return {
    email: $("guest-email").value.trim() || DEFAULT_EMAIL,
    auto_temp_order: $("auto-temp").checked,
    imap_auth_code: $("imap-code").value.trim(),
  };
}

function fillGuestForm(p) {
  $("guest-email").value = p.email || DEFAULT_EMAIL;
  $("auto-temp").checked = p.auto_temp_order !== false;
  if (p.imap_auth_code) $("imap-code").value = p.imap_auth_code;
}

function saveFlow() {
  localStorage.setItem(
    FLOW_KEY,
    JSON.stringify({
      maxUnlocked,
      currentStep,
      urls: urlsEl.value,
      groups: analyzedGroups,
    })
  );
}

function loadFlow() {
  try {
    return JSON.parse(localStorage.getItem(FLOW_KEY) || "{}");
  } catch {
    return {};
  }
}

function goStep(n, { unlock = false } = {}) {
  if (unlock) maxUnlocked = Math.max(maxUnlocked, n);
  if (n > maxUnlocked) return false;
  currentStep = n;

  document.querySelectorAll(".step-page").forEach((page) => {
    const id = Number(page.id.replace("page-", ""));
    const on = id === n;
    page.classList.toggle("is-on", on);
    page.classList.toggle("active", on);
    if (on) page.removeAttribute("hidden");
    else page.setAttribute("hidden", "");
  });

  document.querySelectorAll(".stepper-item").forEach((el) => {
    const s = Number(el.dataset.step);
    el.classList.remove("is-active", "is-done", "is-locked", "active", "done", "locked");
    if (s < n) el.classList.add("is-done");
    else if (s === n) el.classList.add("is-active");
    else el.classList.add("is-locked");
  });

  saveFlow();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (n === 5) startAutoOrderScan();
  else stopAutoOrderScan();
  return true;
}

function unlockAndGo(n) {
  flowUserMoved = true;
  maxUnlocked = Math.max(maxUnlocked, n);
  return goStep(n, { unlock: true });
}

async function clearCacheAndHome() {
  const ok = confirm("确定清除流程缓存并回到首页？进行中的任务也会取消。");
  if (!ok) return;
  try {
    await api("/api/cancel", { method: "POST", body: "{}" });
  } catch {
    /* ignore */
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  stopAutoOrderScan();
  localStorage.removeItem(FLOW_KEY);
  // 保留邮箱授权码，只清流程
  maxUnlocked = 1;
  currentStep = 1;
  analyzedGroups = [];
  lastAnalyzedText = "";
  urlsEl.value = "";
  renderGroups([]);
  renderPayLinks([]);
  renderDownloadLinks([]);
  analyzeHint.textContent = "解析成功后将进入下一步「加购下单」。";
  startHint.textContent = "";
  jobLog.textContent = "（等待任务…）";
  jobStatus.textContent = "任务未开始。";
  jobBadge.textContent = "idle";
  jobBadge.className = "badge";
  btnStart.disabled = true;
  btnToOrders.disabled = true;
  goStep(1);
  if (typeof showMain === "function") showMain();
}

fillGuestForm(loadProfile());
saveProfile(readGuestForm());
["guest-email", "auto-temp", "imap-code"].forEach((id) => {
  $(id).addEventListener("change", () => saveProfile(readGuestForm()));
  $(id).addEventListener("blur", () => saveProfile(readGuestForm()));
});

$("btn-reset").addEventListener("click", () => clearCacheAndHome());

const viewMain = $("view-main");
const viewSettings = $("view-settings");
const mainLede = $("main-lede");
const LEDE_MAIN = "按流程逐步完成。须完成当前步才能进入下一步；邮箱请在右上角「邮箱设置」配置。";
const LEDE_SETTINGS = "配置游客邮箱与 QQ 授权码。保存后返回主流程即可。";

function showSettings() {
  viewMain.hidden = true;
  viewSettings.hidden = false;
  mainLede.textContent = LEDE_SETTINGS;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showMain() {
  viewSettings.hidden = true;
  viewMain.hidden = false;
  mainLede.textContent = LEDE_MAIN;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("btn-settings").addEventListener("click", showSettings);
$("btn-settings-back").addEventListener("click", showMain);

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail;
    const msg = typeof detail === "string" ? detail : data.message || `请求失败 ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

(async () => {
  try {
    const cfg = await api("/api/config");
    if (cfg.email) $("guest-email").value = cfg.email;
    if (cfg.has_auth_code) {
      hasSavedAuth = true;
      imapHint.textContent = `本机已保存授权码（${cfg.imap_auth_code_masked}）。可直接使用；要更换请重新填写并保存。`;
    }
  } catch {
    /* ignore */
  }
})();

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", "&#39;");
}

function renderGroups(groups) {
  analyzedGroups = groups || [];
  groupsEl.innerHTML = "";
  if (!groups || !groups.length) {
    groupsEl.innerHTML = `<p class="empty">暂无商品。</p>`;
    groupsMeta.textContent = "—";
    btnStart.disabled = true;
    return;
  }
  btnStart.disabled = false;
  groupsMeta.textContent = `${groups.length} 个店铺 · ${groups.reduce((n, g) => n + g.count, 0)} 件`;
  for (const g of groups) {
    const el = document.createElement("article");
    el.className = "shop";
    el.innerHTML = `
      <div class="shop-top">
        <strong>第 ${g.index} 店 · ${escapeHtml(g.shop_name)}</strong>
        <span>${g.count} 件 · ${escapeHtml(g.shop)}</span>
      </div>
      <ul>
        ${g.items
          .map(
            (it) => `
          <li>
            <a href="${escapeAttr(it.url)}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a>
            <span class="price">${escapeHtml(it.price)}</span>
            <span class="kind">${escapeHtml(it.kind)} · #${escapeHtml(it.item_id)}</span>
          </li>`
          )
          .join("")}
      </ul>`;
    groupsEl.appendChild(el);
  }
}

function renderPayLinks(links) {
  lastPaymentCount = (links && links.length) || 0;
  if (!links || !links.length) {
    payLinksEl.innerHTML = `<p class="empty">暂无支付链接。</p>`;
    linksMeta.textContent = "0";
    btnToOrders.disabled = true;
    return;
  }
  linksMeta.textContent = `${links.length} 个`;
  btnToOrders.disabled = false;
  payLinksEl.innerHTML = links
    .map(
      (row) => `
    <article class="pay-link">
      <div class="row">
        <span class="shop-label">第 ${row.index} 店 · ${escapeHtml(row.shop_name)}（${row.item_count} 件）</span>
        <a class="link-btn" href="${escapeAttr(row.url)}" target="_blank" rel="noopener">打开支付</a>
      </div>
      <a href="${escapeAttr(row.url)}" target="_blank" rel="noopener">${escapeHtml(row.url)}</a>
    </article>`
    )
    .join("");
}

async function copyToClipboard(text) {
  const value = String(text || "");
  if (!value) throw new Error("空链接");
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    /* fall through */
  }
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, value.length);
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error("复制失败");
}

function bindCopyButtons(root) {
  root.querySelectorAll(".btn-copy").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const url = btn.getAttribute("data-url") || "";
      try {
        await copyToClipboard(url);
        const old = btn.textContent;
        btn.textContent = "已复制";
        setTimeout(() => (btn.textContent = old), 1200);
      } catch {
        alert("复制失败，请长按链接手动复制");
      }
    });
  });
}

function renderDownloadLinks(rows) {
  if (!rows || !rows.length) {
    dlLinksEl.innerHTML = `<p class="empty">正在等待支付完成邮件中的订单链接…</p>`;
    dlMeta.textContent = "0";
    return;
  }
  dlMeta.textContent = `${rows.length} 条`;
  dlLinksEl.innerHTML = rows
    .map((row) => {
      const label = row.matched
        ? `第 ${row.index} 店 · ${escapeHtml(row.shop_name)}`
        : `未匹配 · ${escapeHtml(row.mail_subject || "邮件")}`;
      const url = row.order_url || "";
      return `<article class="pay-link">
        <div class="row">
          <span class="shop-label">${label}</span>
          <div class="row-actions">
            <button type="button" class="ghost btn-copy" data-url="${escapeAttr(url)}">复制链接</button>
            <a class="link-btn" href="${escapeAttr(url)}" target="_blank" rel="noopener">打开</a>
          </div>
        </div>
        <a class="url-line" href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>
      </article>`;
    })
    .join("");

  bindCopyButtons(dlLinksEl);
}

function stopAutoOrderScan() {
  if (orderScanTimer) {
    clearInterval(orderScanTimer);
    orderScanTimer = null;
  }
}

function orderScanEnough(rows) {
  const list = rows || [];
  const matched = list.filter((r) => r.matched).length;
  const need = lastPaymentCount || 0;
  if (need <= 0) return matched > 0;
  return matched >= need;
}

async function scanOrdersOnce({ silent = false } = {}) {
  if (orderScanBusy) return null;
  orderScanBusy = true;
  if (!silent) btnScanDl.disabled = true;
  dlHint.textContent = "正在读邮箱，提取订单详情链接…";
  try {
    const data = await api("/api/downloads/scan", { method: "POST", body: "{}" });
    const rows = data.download_links || [];
    renderDownloadLinks(rows);
    if (orderScanEnough(rows)) {
      const matched = rows.filter((r) => r.matched).length;
      dlHint.textContent = `已取得订单链接：${rows.length} 条（匹配 ${matched} 店）。`;
      stopAutoOrderScan();
    } else {
      const need = lastPaymentCount || "?";
      dlHint.textContent = `已找到 ${rows.length} 条，目标约 ${need} 店。继续自动读取中…`;
    }
    return rows;
  } catch (e) {
    dlHint.textContent = `${e.message}（将自动重试）`;
    return null;
  } finally {
    orderScanBusy = false;
    btnScanDl.disabled = false;
  }
}

function startAutoOrderScan() {
  stopAutoOrderScan();
  dlHint.textContent = "进入本页，开始自动读取订单链接…";
  scanOrdersOnce();
  orderScanTimer = setInterval(() => {
    if (currentStep !== 5) {
      stopAutoOrderScan();
      return;
    }
    scanOrdersOnce({ silent: true });
  }, 8000);
}

btnPaste.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) return;
    urlsEl.value = urlsEl.value.trim()
      ? `${urlsEl.value.trim()}\n${text.trim()}`
      : text.trim();
  } catch {
    analyzeHint.textContent = "无法读取剪贴板，请手动粘贴。";
  }
});

btnImapSave.addEventListener("click", async () => {
  const g = readGuestForm();
  try {
    await api("/api/imap/save", {
      method: "POST",
      body: JSON.stringify({ email: g.email, imap_auth_code: g.imap_auth_code }),
    });
    saveProfile(g);
    hasSavedAuth = true;
    imapHint.textContent = "授权码已保存到本机。可点上方「返回流程」。";
  } catch (e) {
    imapHint.textContent = e.message;
  }
});

btnImapTest.addEventListener("click", async () => {
  const g = readGuestForm();
  imapHint.textContent = "正在测试 IMAP…";
  try {
    const data = await api("/api/imap/test", {
      method: "POST",
      body: JSON.stringify({ email: g.email, imap_auth_code: g.imap_auth_code }),
    });
    saveProfile(g);
    hasSavedAuth = true;
    imapHint.textContent = data.message || "测试成功";
  } catch (e) {
    imapHint.textContent = e.message;
  }
});

// 页面一：解析成功 → 解锁并进入页面二
btnAnalyze.addEventListener("click", async () => {
  btnAnalyze.disabled = true;
  analyzeHint.textContent = "解析中…";
  try {
    const data = await api("/api/analyze", {
      method: "POST",
      body: JSON.stringify({ text: urlsEl.value }),
    });
    lastAnalyzedText = urlsEl.value;
    if (!data.shop_count) throw new Error("没有解析到可用商品");
    renderGroups(data.groups);
    const err = data.errors?.length ? `（${data.errors.length} 条失败已跳过）` : "";
    analyzeHint.textContent = `解析完成：${data.shop_count} 店 / ${data.item_count} 件，正在进入下一步…${err}`;
    // 先解锁再跳转，避免被异步 init 覆盖
    maxUnlocked = Math.max(maxUnlocked, 2);
    saveFlow();
    const ok = unlockAndGo(2);
    if (!ok) {
      analyzeHint.textContent = "解析成功，但跳转失败，请点右上角清除缓存后重试。";
    } else {
      btnStart.disabled = false;
      startHint.textContent = "确认商品后点击「开始加购下单」。";
    }
  } catch (e) {
    analyzeHint.textContent = e.message;
  } finally {
    btnAnalyze.disabled = false;
  }
});

$("btn-back-1").addEventListener("click", () => {
  // 允许回到已完成的上一步修改
  goStep(1);
});

// 页面二：开始加购 → 进入日志页
btnStart.addEventListener("click", async () => {
  const guest = readGuestForm();
  saveProfile(guest);
  if (!guest.imap_auth_code && !hasSavedAuth) {
    const ok = confirm("未填写授权码：读信可能失败。是否先去「邮箱设置」？\n点「取消」继续下单，点「确定」打开设置。");
    if (ok) {
      showSettings();
      return;
    }
  }
  btnStart.disabled = true;
  startHint.textContent = "正在启动…";
  try {
    const data = await api("/api/start", {
      method: "POST",
      body: JSON.stringify({
        text: urlsEl.value || lastAnalyzedText,
        headed: false,
        guest,
      }),
    });
    lastAnalyzedText = urlsEl.value || lastAnalyzedText;
    renderGroups(data.groups);
    startHint.textContent = "已启动，进入日志页…";
    unlockAndGo(3);
    startPolling();
  } catch (e) {
    startHint.textContent = e.message;
    btnStart.disabled = false;
  }
});

btnContinue.addEventListener("click", async () => {
  btnContinue.disabled = true;
  try {
    await api("/api/continue", { method: "POST", body: "{}" });
  } catch (e) {
    jobStatus.textContent = e.message;
  } finally {
    btnContinue.disabled = false;
  }
});

btnCancel.addEventListener("click", async () => {
  await api("/api/cancel", { method: "POST", body: "{}" });
});

btnToOrders.addEventListener("click", () => {
  unlockAndGo(5);
});

btnScanDl.addEventListener("click", () => {
  startAutoOrderScan();
});

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshStatus, 800);
  refreshStatus();
}

async function refreshStatus() {
  try {
    const s = await api("/api/status");
    jobBadge.textContent = s.status;
    jobBadge.className = "badge";
    if (["waiting_payment", "waiting_email", "reading_email"].includes(s.status)) {
      jobBadge.classList.add("wait");
    }
    if (s.status === "done") jobBadge.classList.add("done");
    if (s.status === "error" || s.status === "cancelled") jobBadge.classList.add("err");

    jobStatus.textContent = s.hint || "";
    btnContinue.hidden = !["waiting_payment", "waiting_email"].includes(s.status);
    btnCancel.hidden = ![
      "adding",
      "guest_checkout",
      "reading_email",
      "waiting_email",
      "waiting_payment",
      "running",
    ].includes(s.status);

    const link = s.page_url || s.cart_url;
    if (
      link &&
      ["waiting_payment", "waiting_email", "adding", "guest_checkout", "reading_email", "running"].includes(
        s.status
      )
    ) {
      cartLink.hidden = false;
      cartLink.href = link;
    } else {
      cartLink.hidden = true;
    }

    if (
      ["adding", "guest_checkout", "reading_email", "running"].includes(s.status) &&
      !jobStatus.textContent
    ) {
      jobStatus.textContent = `正在处理第 ${s.current_index}/${s.total_shops} 店…`;
    }

    const logs = s.logs || [];
    jobLog.textContent = logs.length ? logs.join("\n") : "（等待任务…）";
    jobLog.scrollTop = jobLog.scrollHeight;

    if (s.payment_links && s.payment_links.length) {
      renderPayLinks(s.payment_links);
    }
    if (s.download_links && s.download_links.length) {
      renderDownloadLinks(s.download_links);
    }

    if (["done", "error", "cancelled"].includes(s.status)) {
      btnStart.disabled = false;
      clearInterval(pollTimer);
      if (s.status === "error") {
        jobStatus.textContent = s.error || "出错了";
      }
      if (s.status === "done") {
        const n = (s.payment_links || []).length;
        jobStatus.textContent = s.hint || `全部完成，共 ${n} 个支付链接。`;
        renderPayLinks(s.payment_links || []);
        // 完成后自动进入支付链接页
        unlockAndGo(4);
      }
      if (s.status === "cancelled") {
        jobStatus.textContent = "任务已取消";
      }
    }
  } catch {
    /* ignore */
  }
}

// 恢复流程：仅允许到已解锁步骤；进行中任务回到日志页
(async function initFlow() {
  const flow = loadFlow();
  if (flow.urls) urlsEl.value = flow.urls;
  if (flow.groups && flow.groups.length) {
    renderGroups(flow.groups);
    lastAnalyzedText = flow.urls || "";
  }

  try {
    const s = await api("/api/status");
    if (flowUserMoved) return; // 用户已点解析并跳转，勿回拨

    const running = [
      "adding",
      "guest_checkout",
      "reading_email",
      "waiting_email",
      "waiting_payment",
      "running",
    ].includes(s.status);

    if (running) {
      maxUnlocked = Math.max(3, flow.maxUnlocked || 1);
      unlockAndGo(3);
      startPolling();
      return;
    }
    if (s.status === "done" && (s.payment_links || []).length) {
      renderPayLinks(s.payment_links);
      maxUnlocked = Math.max(4, flow.maxUnlocked || 1);
      if (s.download_links && s.download_links.length) {
        renderDownloadLinks(s.download_links);
        maxUnlocked = Math.max(5, maxUnlocked);
      }
      goStep(Math.min(flow.currentStep || 4, maxUnlocked));
      return;
    }
  } catch {
    /* ignore */
  }

  if (flowUserMoved) return; // 解析跳转后，status 请求才返回时不要强制回第1步

  maxUnlocked = Math.min(Math.max(flow.maxUnlocked || 1, 1), 2); // 刷新后最多保留到第2步，需重新跑任务
  if (analyzedGroups.length) maxUnlocked = Math.max(maxUnlocked, 2);
  goStep(Math.min(flow.currentStep || 1, maxUnlocked));
})();
