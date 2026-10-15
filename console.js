import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  Timestamp,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { accountCollection, auth, controlAdminEmail, db } from "./firebase.js";

const loading = document.getElementById("accountLoading");
const card = document.getElementById("accountCard");
  const errorBox = document.getElementById("accountError");
const signOutButton = document.getElementById("signOut");
const requiredElements = [
  ["accountLoading", loading], ["accountCard", card], ["accountError", errorBox],
  ["signOut", signOutButton], ["checkoutButton", document.getElementById("checkoutButton")],
  ["refreshPayments", document.getElementById("refreshPayments")],
];
let accountLoadVersion = 0;
let activeUserEmail = "";
let refreshPaymentStatus = null;
let unsubscribePaymentRequests = null;
let hasPendingPaymentRequest = false;
let activePaymentOrder = null;
let latestPaymentOrders = [];
let paymentOrdersLoaded = false;
let observedPaymentOrderStatuses = new Map();
let paymentOrderSnapshotInitialized = false;
let demoPackageVisible = false;
let demoPackageSettingsLoaded = false;
let unsubscribeDemoPackage = null;
let paymentCountdownTimer = null;
let lastPaymentTrigger = null;
let selectedBillingPeriod = "monthly";
let selectedUniqueCode = Math.floor(Math.random() * 300) + 1;
const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
let qrisSourcePayloadPromise = null;
let qrisDecoderModulePromise = null;
let qrisRenderVersion = 0;

function calculateQrisCrc(payload) {
  let crc = 0xffff;
  for (let index = 0; index < payload.length; index += 1) {
    crc ^= payload.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function createAmountQrisPayload(payload, amount) {
  const fields = [];
  for (let offset = 0; offset < payload.length;) {
    const tag = payload.slice(offset, offset + 2);
    const length = Number(payload.slice(offset + 2, offset + 4));
    if (!/^\d{2}$/.test(tag) || !Number.isFinite(length)) throw new Error("Format QRIS sumber tidak valid.");
    fields.push({ tag, value: payload.slice(offset + 4, offset + 4 + length) });
    offset += 4 + length;
    if (tag === "63") break;
  }
  const crc = fields.at(-1);
  if (crc?.tag !== "63" || calculateQrisCrc(payload.slice(0, -4)) !== crc.value.toUpperCase()) throw new Error("Checksum QRIS sumber tidak cocok.");
  const bodyFields = fields.slice(0, -1);
  const poi = bodyFields.find((field) => field.tag === "01");
  if (poi) poi.value = "12"; else bodyFields.splice(1, 0, { tag: "01", value: "12" });
  if (!bodyFields.some((field) => field.tag === "53" && field.value === "360")) throw new Error("QRIS sumber bukan Rupiah.");
  const filtered = bodyFields.filter((field) => field.tag !== "54");
  const currency = filtered.findIndex((field) => field.tag === "53");
  filtered.splice(currency + 1, 0, { tag: "54", value: `${amount}.00` });
  const body = filtered.map(({ tag, value }) => `${tag}${String(value.length).padStart(2, "0")}${value}`).join("") + "6304";
  return body + calculateQrisCrc(body);
}

async function readStaticQrisPayload() {
  if (qrisSourcePayloadPromise) return qrisSourcePayloadPromise;
  qrisSourcePayloadPromise = (async () => {
    const image = document.getElementById("qrisStaticImage");
    if (!image) throw new Error("QRIS merchant tidak ditemukan.");
    // BarcodeDetector cannot decode an image rendered with display:none.
    image.classList.remove("hidden");
    if (!image.complete) await new Promise((resolve, reject) => { image.addEventListener("load", resolve, { once: true }); image.addEventListener("error", () => reject(new Error("Gambar QRIS gagal dimuat.")), { once: true }); });
    if (!image.naturalWidth) throw new Error("Gambar QRIS tidak dapat dibaca.");
    if ("BarcodeDetector" in window) {
      try {
        const result = await new BarcodeDetector({ formats: ["qr_code"] }).detect(image);
        const payload = result.find((code) => code.rawValue)?.rawValue;
        if (payload) return payload;
      } catch (error) { console.info("BarcodeDetector tidak tersedia untuk QRIS, menggunakan decoder alternatif.", error); }
    }
    if (window.jsQR) {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const decoded = window.jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
      if (decoded?.data) return decoded.data;
    }
    qrisDecoderModulePromise ||= import("https://esm.sh/@zxing/browser@0.1.5");
    const { BrowserQRCodeReader } = await qrisDecoderModulePromise;
    return (await new BrowserQRCodeReader().decodeFromImageElement(image)).getText();
  })();
  try { return await qrisSourcePayloadPromise; } catch (error) { qrisSourcePayloadPromise = null; throw error; }
}

async function renderAmountQris(amount) {
  const version = ++qrisRenderVersion;
  const display = document.getElementById("dynamicQrisDisplay");
  const status = document.getElementById("qrisDynamicStatus");
  const instruction = document.getElementById("qrisPaymentInstruction");
  const staticImage = document.getElementById("qrisStaticImage");
  if (!display || !status || !instruction || !staticImage) return;
  staticImage.classList.remove("hidden");
  status.textContent = "Membuat QRIS dinamis sesuai total...";
  try {
    const source = await readStaticQrisPayload();
    if (!window.QRCode) throw new Error("Library QRIS belum termuat.");
    const payload = createAmountQrisPayload(source, amount);
    if (version !== qrisRenderVersion) return;
    display.replaceChildren();
    new window.QRCode(display, { text: payload, width: 280, height: 280, colorDark: "#000", colorLight: "#fff", correctLevel: window.QRCode.CorrectLevel.M });
    display.classList.remove("hidden"); staticImage.classList.add("hidden");
    status.textContent = "QRIS dinamis siap — total sudah tercantum di QR.";
    instruction.textContent = "Pindai QR dengan aplikasi bank atau e-wallet yang mendukung QRIS.";
    return true;
  } catch (error) {
    if (version !== qrisRenderVersion) return;
    display.classList.add("hidden"); staticImage.classList.add("hidden");
    status.textContent = "QR dinamis tidak berhasil dibuat.";
    instruction.textContent = "Periksa gambar QRIS merchant dan koneksi internet, lalu coba lagi.";
    console.warn("QRIS dinamis gagal dibuat:", error);
    return false;
  }
}
function renderPaymentBrandMarks() {
  const badges = document.querySelector(".payment-method-badges");
  if (!badges || badges.dataset.branded) return;
  const brands = [["Mandiri", "M", "#003d79"], ["BSI", "BSI", "#00a39a"], ["BNI", "BNI", "#f36f21"], ["BCA", "BCA", "#1474c8"], ["BRI", "BRI", "#00529b"], ["Sumsel Babel", "SB", "#17814b"], ["DANA", "D", "#1688e8"], ["GoPay", "Go", "#00a5e8"], ["OVO", "OVO", "#4b2b82"], ["ShopeePay", "S", "#ee4d2d"]];
  badges.replaceChildren();
  for (const [name, mark, color] of brands) {
    const item = document.createElement("span");
    const logo = document.createElement("b"); logo.className = "payment-brand-mark"; logo.textContent = mark; logo.style.color = color; logo.setAttribute("aria-hidden", "true");
    const label = document.createElement("b"); label.textContent = name;
    item.append(logo, label); badges.append(item);
  }
  badges.dataset.branded = "true";
}
renderPaymentBrandMarks();
function updateSelectedPaymentPackage(period = selectedBillingPeriod) {
  selectedBillingPeriod = ["monthly", "yearly", "demo_10m"].includes(period) ? period : "monthly";
  if (selectedBillingPeriod === "demo_10m" && !demoPackageVisible) selectedBillingPeriod = "monthly";
  selectedUniqueCode = Math.floor(Math.random() * 300) + 1;
  const baseAmount = selectedBillingPeriod === "yearly" ? 1100000 : selectedBillingPeriod === "demo_10m" ? 1000 : 150000;
  document.querySelectorAll("[data-billing-period]").forEach((button) => {
    const selected = button.dataset.billingPeriod === selectedBillingPeriod;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  const checkoutTitle = document.getElementById("checkoutTitle");
  if (checkoutTitle && !checkoutTitle.textContent.includes("Perpanjang")) checkoutTitle.textContent = selectedBillingPeriod === "demo_10m" ? "Pilih paket demo Premium" : "Pilih paket untuk mengaktifkan Premium";
  const totalAmount = baseAmount + selectedUniqueCode;
  const baseElement = document.getElementById("qrisBaseAmount");
  if (baseElement) baseElement.textContent = rupiah.format(baseAmount);
  const totalElement = document.getElementById("qrisPaymentAmount");
  const uniqueElement = document.getElementById("qrisUniqueCode");
  if (totalElement) totalElement.textContent = rupiah.format(totalAmount);
  if (uniqueElement) uniqueElement.textContent = rupiah.format(selectedUniqueCode);
}

document.querySelectorAll("[data-billing-period]").forEach((button) => {
  button.addEventListener("click", () => updateSelectedPaymentPackage(button.dataset.billingPeriod));
});
updateSelectedPaymentPackage();

function subscribeDemoPackageSettings() {
  unsubscribeDemoPackage?.();
  demoPackageSettingsLoaded = false;
  unsubscribeDemoPackage = onSnapshot(doc(db, "public_settings", "demo_package"), (snapshot) => {
    demoPackageSettingsLoaded = true;
    demoPackageVisible = !snapshot.exists() || snapshot.data().demoVisible !== false;
    document.getElementById("demoPackageOption")?.classList.toggle("hidden", !demoPackageVisible);
    if (!demoPackageVisible && selectedBillingPeriod === "demo_10m") updateSelectedPaymentPackage("monthly");
  }, (error) => {
    demoPackageSettingsLoaded = true;
    demoPackageVisible = false;
    document.getElementById("demoPackageOption")?.classList.add("hidden");
    if (selectedBillingPeriod === "demo_10m") updateSelectedPaymentPackage("monthly");
    console.warn("Pengaturan paket demo tidak dapat dimuat:", error);
  });
}

function installPortalIcons() {
  const icons = [
    ['#dashboardSection .dashboard-stat:nth-child(1) .dashboard-stat-icon', '<path d="m12 2 2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3L12 2Z"/>'],
    ['#dashboardSection .dashboard-stat:nth-child(2) .dashboard-stat-icon', '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>'],
    ['#dashboardSection .dashboard-stat:nth-child(3) .dashboard-stat-icon', '<path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.3"/>'],
    ['#dashboardSection .quick-link:nth-child(1) .quick-link-icon', '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'],
    ['#dashboardSection .quick-link:nth-child(2) .quick-link-icon', '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>'],
    ['#profileSection .profile-plan-card .portal-icon', '<path d="m12 2 2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3L12 2Z"/>'],
    ['#profileSection .portal-card:not(.profile-plan-card) .portal-icon', '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'],
    ['#websiteSection .portal-icon', '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>'],
  ];
  for (const [selector, path] of icons) {
    const element = document.querySelector(selector);
    if (element) element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  }
}
installPortalIcons();

function formatAccountDateTime(value) {
  if (!value) return "Belum tersedia";
  const date = value?.toDate?.() || (value instanceof Date ? value : typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59+07:00`) : new Date(value));
  if (Number.isNaN(date.getTime())) return "Belum tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta",
  }).format(date) + " WIB";
}

function parseAccountDate(value) {
  if (!value) return null;
  const date = value?.toDate?.() || (value instanceof Date ? value : typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59+07:00`) : new Date(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function tenantFirebaseStatus(account) {
  return account.tenantFirebaseStatus || (account.tenantFirebaseConfig || account.tenantProjectId || account.hostingStatus === "ready" ? "active" : "not_configured");
}

function websiteTimelineSteps(account) {
  const saved = account.websiteTimeline || {};
  const hosting = saved.hosting || (account.hostingStatus === "ready" ? "complete" : ["preparing", "configuring"].includes(account.hostingStatus) ? "in_progress" : "pending");
  const firebase = tenantFirebaseStatus(account);
  const database = saved.database || (firebase === "active" ? "complete" : hosting === "complete" && (account.tenantProjectId || account.tenantFirebaseConfig || account.plan === "premium") ? "in_progress" : "pending");
  const domain = saved.domain || (account.hostingStatus === "ready" && account.domainName && account.websiteUrl ? "complete" : database === "complete" && account.domainName ? "in_progress" : "pending");
  return [
    { key: "hosting", title: "Persiapan hosting", description: "Menyiapkan ruang dan layanan untuk website SPPG Anda.", status: hosting },
    { key: "database", title: "Persiapan database", description: "Menyiapkan database dan koneksi Firebase website.", status: database },
    { key: "domain", title: "Menghubungkan ke domain", description: account.domainName ? `Menyiapkan alamat ${account.domainName} agar dapat diakses.` : "Menunggu domain website ditentukan.", status: domain },
  ];
}

function renderWebsiteTimeline(account) {
  const list = document.getElementById("websiteTimeline");
  const progress = document.getElementById("websiteTimelineProgress");
  if (!list || !progress) return;
  list.replaceChildren();
  const labels = { complete: "Selesai", in_progress: "Sedang diproses", pending: "Menunggu" };
  const steps = websiteTimelineSteps(account);
  const completed = steps.filter((step) => step.status === "complete").length;
  progress.textContent = `${completed} dari ${steps.length} selesai`;
  for (const step of steps) {
    const item = document.createElement("li");
    item.className = `website-timeline-step is-${labels[step.status] ? step.status : "pending"}`;
    const marker = document.createElement("span"); marker.className = "website-timeline-marker"; marker.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div"); copy.className = "website-timeline-copy";
    const title = document.createElement("strong"); title.textContent = step.title;
    const description = document.createElement("p"); description.textContent = step.description;
    copy.append(title, description);
    const state = document.createElement("span"); state.className = "website-timeline-state"; state.textContent = labels[step.status] || labels.pending;
    item.append(marker, copy, state); list.append(item);
  }
}

function renderNotificationCenter(account, payments = []) {
  const list = document.getElementById("notificationList");
  const count = document.getElementById("notificationCount");
  if (!list || !count) return;
  const notices = [];
  const expiry = parseAccountDate(account.premiumExpiresAt);
  if (account.plan === "premium" && expiry) {
    const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / 86400000);
    if (daysLeft <= 14) notices.push({ tone: daysLeft < 0 ? "urgent" : "warning", title: daysLeft < 0 ? "Premium telah berakhir" : daysLeft === 0 ? "Premium berakhir hari ini" : `Premium berakhir dalam ${daysLeft} hari`, detail: `Masa aktif sampai ${formatAccountDateTime(account.premiumExpiresAt)}.`, href: "./console.html?view=payments", action: daysLeft < 0 ? "Aktifkan kembali" : "Perpanjang" });
  }
  const steps = websiteTimelineSteps(account);
  const done = steps.filter((step) => step.status === "complete").length;
  const hostingStatus = account.hostingStatus || (account.plan === "premium" ? "preparing" : "not_purchased");
  const websiteLabel = { not_purchased: "Belum disiapkan", preparing: "Sedang disiapkan", configuring: "Sedang dikonfigurasi", ready: "Siap" }[hostingStatus] || "Sedang disiapkan";
  notices.push({ tone: hostingStatus === "ready" ? "success" : "info", title: `Website ${websiteLabel.toLowerCase()}`, detail: `${done} dari ${steps.length} tahap persiapan selesai${account.domainName ? ` · ${account.domainName}` : ""}.`, href: "./console.html?view=website", action: "Lihat progres" });
  const latest = [...payments].sort((a, b) => (b.createdAt?.toMillis?.() || new Date(b.createdAt || 0).getTime() || 0) - (a.createdAt?.toMillis?.() || new Date(a.createdAt || 0).getTime() || 0))[0];
  if (latest) {
    const labels = { pending: "menunggu verifikasi", received: "terverifikasi", rejected: "ditolak" };
    notices.push({ tone: latest.status === "rejected" ? "warning" : latest.status === "received" ? "success" : "info", title: `Pembayaran ${labels[latest.status] || "sedang diproses"}`, detail: `Pengajuan terbaru ${formatAccountDateTime(latest.createdAt)}.`, href: "./console.html?view=payments", action: "Lihat pembayaran" });
  }
  count.textContent = `${notices.length} ${notices.length === 1 ? "pembaruan" : "pembaruan"}`;
  list.replaceChildren();
  for (const notice of notices) {
    const item = document.createElement("article"); item.className = `notification-item is-${notice.tone}`;
    const marker = document.createElement("span"); marker.className = "notification-marker"; marker.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div"); copy.className = "notification-copy";
    const title = document.createElement("strong"); title.textContent = notice.title;
    const detail = document.createElement("p"); detail.textContent = notice.detail; copy.append(title, detail);
    const link = document.createElement("a"); link.href = notice.href; link.textContent = notice.action;
    item.append(marker, copy, link); list.append(item);
  }
  if (!notices.length) list.innerHTML = '<p class="notification-empty">Belum ada pembaruan untuk akun Anda.</p>';
}

function firebaseStatusLabel(status, isPremium = false) {
  if (isPremium && status === "not_configured") return "Sedang disiapkan";
  return ({ active: "Aktif", maintenance: "Pemeliharaan", suspended: "Dinonaktifkan", not_configured: "Belum dikonfigurasi" })[status] || "Belum dikonfigurasi";
}

function isWebsiteAvailable(account, isPremium) {
  const expiry = parseAccountDate(account.websiteExpiresAt || account.premiumExpiresAt);
  const withinWebsiteValidity = !expiry || expiry.getTime() > Date.now();
  return isPremium && account.hostingStatus === "ready" && tenantFirebaseStatus(account) === "active"
    && withinWebsiteValidity && /^https?:\/\//i.test(account.websiteUrl || "");
}

function renderPremiumExpiry(account) {
  const expiry = parseAccountDate(account.premiumExpiresAt);
  const expiryLabel = formatAccountDateTime(account.premiumExpiresAt);
  for (const id of ["sidebarExpiresAt", "dashboardExpiresAt", "profilePremiumExpiresAt", "websitePremiumExpiresAt"]) {
    const element = document.getElementById(id);
    if (element) element.textContent = expiryLabel;
  }
  const countdownRow = document.getElementById("dashboardExpiryCountdownRow");
  const notice = document.getElementById("renewalNotice");
  if (!expiry || Number.isNaN(expiry.getTime()) || account.plan !== "premium") {
    countdownRow?.classList.add("hidden");
    notice?.classList.add("hidden");
    document.getElementById("checkoutPanel")?.classList.toggle("hidden", account.plan === "premium");
    return;
  }
  const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / 86400000);
  const countdown = document.getElementById("dashboardExpiryCountdown");
  if (countdown) countdown.textContent = daysLeft < 0 ? "Sudah berakhir" : daysLeft === 0 ? "Berakhir hari ini" : `${daysLeft} hari lagi`;
  countdownRow?.classList.remove("hidden");
  const needsRenewal = daysLeft <= 7;
  notice?.classList.toggle("hidden", !needsRenewal);
  const title = document.getElementById("renewalNoticeTitle");
  const description = document.getElementById("renewalNoticeDescription");
  if (title) title.textContent = daysLeft < 0 ? "Paket Premium sudah berakhir" : daysLeft === 0 ? "Paket Premium berakhir hari ini" : "Paket Premium segera berakhir";
  if (description) description.textContent = daysLeft < 0 ? "Buat pembayaran QRIS untuk mengaktifkan kembali layanan Premium." : `Masa aktif tersisa ${daysLeft} hari, sampai ${expiryLabel}.`;
  const checkoutPanel = document.getElementById("checkoutPanel");
  checkoutPanel?.classList.toggle("hidden", daysLeft > 7);
  const checkoutTitle = document.getElementById("checkoutTitle");
  const checkoutButton = document.getElementById("checkoutButton");
  const secureNote = document.querySelector("#checkoutPanel .checkout-secure-note");
  if (checkoutTitle && daysLeft <= 7) checkoutTitle.textContent = daysLeft < 0 ? "Aktifkan kembali Premium" : "Perpanjang paket Premium";
  if (checkoutButton && daysLeft <= 7 && !activePaymentOrder) checkoutButton.innerHTML = 'Buat pembayaran perpanjangan <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
  if (secureNote && daysLeft <= 7) secureNote.textContent = "Buat pesanan QRIS dan selesaikan pembayaran dalam 24 jam.";
}

const viewMeta = {
  dashboard: ["DASHBOARD", "Dashboard", "Ringkasan akun dan status layanan SPPG Smart Anda."],
  profile: ["PROFIL PENGGUNA", "Profil", "Informasi akun Google yang terhubung ke SPPG Smart."],
  website: ["WEBSITE SPPG", "Website", "Domain dan lingkungan website yang terhubung ke akun Anda."],
  payments: ["PAKET & TRANSAKSI", "Pembayaran", "Kelola paket Premium dan pantau status transaksi Anda."],
};
const activeView = new URLSearchParams(window.location.search).get("view") || "dashboard";
const currentView = viewMeta[activeView] ? activeView : "dashboard";
document.querySelectorAll("[data-view-link]").forEach((link) => link.classList.toggle("active", link.dataset.viewLink === currentView));
document.getElementById("viewEyebrow").textContent = viewMeta[currentView][0];
document.getElementById("viewTitle").textContent = viewMeta[currentView][1];
document.getElementById("viewDescription").textContent = viewMeta[currentView][2];
document.getElementById("topbarView").textContent = viewMeta[currentView][1];
document.getElementById("dashboardSection").classList.toggle("hidden", currentView !== "dashboard");
document.getElementById("profileSection").classList.toggle("hidden", currentView !== "profile");
document.getElementById("websiteSection").classList.toggle("hidden", currentView !== "website");
document.getElementById("paymentSection").classList.toggle("hidden", currentView !== "payments");

function showError(message) {
  errorBox.replaceChildren();
  errorBox.append(document.createTextNode(message + " "));
  const link = document.createElement("a");
  link.href = "./index.html";
  link.textContent = "Kembali ke landing page";
  errorBox.append(link);
  errorBox.classList.remove("hidden");
  loading.classList.add("hidden");
}

signOutButton.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.assign("./index.html");
  } catch (error) {
    showError(`Gagal keluar: ${error.message}`);
  }
});

const missingElement = requiredElements.find(([, element]) => !element);
if (missingElement) {
  showError(`Halaman akun belum lengkap: elemen #${missingElement[0]} tidak ditemukan. Muat ulang file console.html dan console.js.`);
  throw new Error(`Missing required console element: #${missingElement[0]}`);
}

function startPaymentCountdown(expiresAt) {
  clearInterval(paymentCountdownTimer);
  const expiry = parseAccountDate(expiresAt);
  const label = document.getElementById("paymentExpiryLabel");
  if (label) label.textContent = formatAccountDateTime(expiry);
  const tick = () => {
    const remaining = Math.max(0, expiry.getTime() - Date.now());
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    const counter = document.getElementById("paymentCountdown");
    if (counter) counter.textContent = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
    if (!remaining) {
      clearInterval(paymentCountdownTimer);
      document.getElementById("qrisDynamicStatus").textContent = "Waktu pembayaran telah habis. Buat pembayaran baru untuk melanjutkan.";
      document.getElementById("checkoutButton").disabled = false;
      document.getElementById("checkoutButton").textContent = "Buat pembayaran baru";
      activePaymentOrder = { ...activePaymentOrder, status: "expired" };
    }
  };
  tick(); paymentCountdownTimer = window.setInterval(tick, 1000);
}

function closePaymentDialog() {
  const details = document.getElementById("qrisPaymentDetails");
  const checkoutPanel = document.getElementById("checkoutPanel");
  if (details && checkoutPanel && details.parentElement !== checkoutPanel) checkoutPanel.insertBefore(details, document.getElementById("checkoutButton"));
  details?.classList.add("hidden");
  document.getElementById("paymentDialog")?.classList.add("hidden");
  if (document.getElementById("paymentAlertDialog")?.classList.contains("hidden")) document.body.classList.remove("payment-dialog-open");
  lastPaymentTrigger?.focus?.();
}

document.getElementById("closePaymentDialog")?.addEventListener("click", closePaymentDialog);
document.getElementById("paymentDialogDone")?.addEventListener("click", closePaymentDialog);
document.getElementById("cancelPaymentOrder")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const order = activePaymentOrder;
  if (!order?.id || order.status !== "pending" || parseAccountDate(order.expiresAt)?.getTime() <= Date.now()) return;
  button.disabled = true;
  button.textContent = "Membatalkan...";
  try {
    await updateDoc(doc(db, "payment_orders", order.id), { status: "cancelled", updatedAt: serverTimestamp() });
    activePaymentOrder = { ...order, status: "cancelled" };
    latestPaymentOrders = latestPaymentOrders.map((item) => item.id === order.id ? { ...item, status: "cancelled" } : item);
    clearInterval(paymentCountdownTimer);
    document.getElementById("qrisStaticImage")?.classList.add("hidden");
    document.getElementById("dynamicQrisDisplay")?.classList.add("hidden");
    document.getElementById("paymentCountdown").textContent = "Dibatalkan";
    document.getElementById("qrisDynamicStatus").textContent = "Pesanan ini dibatalkan dan tidak dapat dibayar lagi.";
    button.classList.add("hidden");
    const checkoutButton = document.getElementById("checkoutButton");
    checkoutButton.textContent = "Buat pembayaran";
    checkoutButton.disabled = false;
    document.querySelectorAll("[data-billing-period]").forEach((item) => item.disabled = false);
  } catch (error) {
    console.error("Gagal membatalkan pembayaran:", error);
    document.getElementById("qrisDynamicStatus").textContent = "Pesanan gagal dibatalkan. Periksa koneksi lalu coba lagi.";
    button.disabled = false;
    button.textContent = "Batalkan pembayaran";
  }
});
document.getElementById("paymentDialog")?.addEventListener("click", (event) => {
  if (event.target.id === "paymentDialog") closePaymentDialog();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.getElementById("paymentDialog")?.classList.contains("hidden")) closePaymentDialog();
});

async function openPaymentOrder(order, orderId, { deferCountdown = false, failCheckoutOnQrError = false } = {}) {
  activePaymentOrder = { ...order, id: orderId };
  lastPaymentTrigger = document.activeElement;
  const details = document.getElementById("qrisPaymentDetails");
  const dialogContent = document.getElementById("paymentDialogContent");
  if (details.parentElement !== dialogContent) dialogContent.append(details);
  details.classList.remove("hidden");
  document.getElementById("paymentDialog").classList.remove("hidden");
  document.body.classList.add("payment-dialog-open");
  document.getElementById("paymentDialogTitle").textContent = order.billingPeriod === "demo_10m" ? "Pembayaran Premium Demo 10 Menit" : `Pembayaran ${order.billingPeriod === "yearly" ? "Premium Tahunan" : "Premium Bulanan"}`;
  document.getElementById("paymentDialogDescription").textContent = order.billingPeriod === "demo_10m"
    ? `Pesanan ${orderId} · akses demo 10 menit dimulai setelah pembayaran diverifikasi admin.`
    : `Pesanan ${orderId} · pindai QRIS sebelum batas waktu berakhir.`;
  document.getElementById("closePaymentDialog").focus();
  document.getElementById("qrisPaymentAmount").textContent = rupiah.format(order.amount);
  document.getElementById("qrisBaseAmount").textContent = rupiah.format(order.billingPeriod === "yearly" ? 1100000 : order.billingPeriod === "demo_10m" ? 1000 : 150000);
  document.getElementById("qrisUniqueCode").textContent = rupiah.format(order.uniqueCode);
  document.getElementById("qrisUniqueRow")?.classList.remove("hidden");
  const expired = parseAccountDate(order.expiresAt)?.getTime() <= Date.now() || order.status === "expired";
  const terminal = ["paid", "successful", "succeeded", "cancelled", "canceled", "failed"].includes(order.status);
  const cancelled = order.status === "cancelled" || order.status === "canceled";
  const cancelButton = document.getElementById("cancelPaymentOrder");
  cancelButton?.classList.toggle("hidden", order.status !== "pending" || expired);
  if (cancelButton) { cancelButton.disabled = false; cancelButton.textContent = "Batalkan pembayaran"; }
  const qrImage = document.getElementById("qrisStaticImage");
  const dynamicQr = document.getElementById("dynamicQrisDisplay");
  const button = document.getElementById("checkoutButton");
  button.textContent = cancelled ? "Buat pembayaran" : terminal ? "Pembayaran sudah diproses" : expired ? "Buat pembayaran baru" : "Buka pembayaran";
  button.disabled = false;
  document.querySelectorAll("[data-billing-period]").forEach((item) => item.disabled = (!expired || terminal) && !cancelled);
  if (terminal) {
    clearInterval(paymentCountdownTimer);
    qrImage?.classList.add("hidden"); dynamicQr?.classList.add("hidden");
    document.getElementById("paymentCountdown").textContent = "Selesai";
    document.getElementById("qrisDynamicStatus").textContent = order.status === "cancelled" || order.status === "canceled" ? "Pesanan ini dibatalkan dan tidak dapat dibayar lagi." : order.status === "failed" ? "Pembayaran ini berstatus gagal dan tidak dapat digunakan ulang." : "Pembayaran ini sudah berhasil diproses.";
  } else if (!expired) {
    qrImage?.classList.remove("hidden");
    const qrisReady = await renderAmountQris(order.amount);
    if (!qrisReady) {
      if (failCheckoutOnQrError) {
        closePaymentDialog();
        activePaymentOrder = null;
        throw new Error("QR dinamis tidak berhasil dibuat. Pesanan belum disimpan. Periksa QRIS merchant dan koneksi internet, lalu coba lagi.");
      }
      document.getElementById("paymentCountdown").textContent = "QRIS belum siap";
      return false;
    }
    if (!deferCountdown) startPaymentCountdown(order.expiresAt);
  } else {
    clearInterval(paymentCountdownTimer);
    qrImage?.classList.add("hidden"); dynamicQr?.classList.add("hidden");
    document.getElementById("paymentCountdown").textContent = "00:00:00";
    document.getElementById("qrisDynamicStatus").textContent = "Pesanan ini sudah kedaluwarsa.";
  }
}

function showPaymentAlert(title, message, type = "warning") {
  const dialog = document.getElementById("paymentAlertDialog");
  if (!dialog) { window.alert(message); return; }
  const icon = document.getElementById("paymentAlertIcon");
  document.getElementById("paymentAlertTitle").textContent = title;
  document.getElementById("paymentAlertMessage").textContent = message;
  document.getElementById("paymentAlertKicker").textContent = type === "success" ? "PEMBAYARAN BERHASIL" : type === "error" ? "PEMBAYARAN GAGAL" : "PERINGATAN PEMBAYARAN";
  if (icon) {
    icon.textContent = type === "success" ? "✓" : type === "error" ? "×" : "!";
    icon.classList.toggle("payment-alert-icon-success", type === "success");
    icon.classList.toggle("payment-alert-icon-error", type === "error");
  }
  dialog.classList.remove("hidden");
  document.body.classList.add("payment-dialog-open");
  document.getElementById("paymentAlertClose").focus();
}

function closePaymentAlert() {
  document.getElementById("paymentAlertDialog")?.classList.add("hidden");
  if (document.getElementById("paymentDialog")?.classList.contains("hidden")) document.body.classList.remove("payment-dialog-open");
}
document.getElementById("paymentAlertClose")?.addEventListener("click", closePaymentAlert);
document.getElementById("paymentAlertDialog")?.addEventListener("click", (event) => { if (event.target.id === "paymentAlertDialog") closePaymentAlert(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closePaymentAlert(); });

async function requestCheckout() {
  const button = document.getElementById("checkoutButton");
  const message = document.getElementById("checkoutMessage");
  let paymentStep = "menyiapkan data pesanan";
  button.disabled = true; button.textContent = "Membuat pembayaran..."; message.textContent = "";
  try {
    const user = auth.currentUser;
    if (!user?.email) throw new Error("Silakan login kembali.");
    if (!paymentOrdersLoaded) throw new Error("Riwayat pembayaran masih dimuat. Coba beberapa detik lagi.");
    const blockingOrder = latestPaymentOrders.find((order) => ["pending", "paid", "successful", "succeeded"].includes(order.status) && parseAccountDate(order.expiresAt)?.getTime() > Date.now());
    if (blockingOrder) {
      const warning = blockingOrder.status === "pending"
        ? "Masih ada pembayaran aktif. Buka pesanan itu dari riwayat atau tunggu hingga masa 24 jam berakhir."
        : "Pembayaran ini sudah diproses. Pesanan baru dapat dibuat setelah batas 24 jam berakhir.";
      showPaymentAlert("Pembayaran belum dapat dibuat", warning, "warning");
      return;
    }
    if (!demoPackageSettingsLoaded) throw new Error("Pengaturan paket belum termuat. Coba beberapa saat lagi.");
    if (selectedBillingPeriod === "demo_10m" && !demoPackageVisible) throw new Error("Paket demo sedang tidak tersedia.");
    const baseAmount = selectedBillingPeriod === "yearly" ? 1100000 : selectedBillingPeriod === "demo_10m" ? 1000 : 150000;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
    const order = {
      email: user.email.toLowerCase(), displayName: user.displayName || "", amount: baseAmount + selectedUniqueCode,
      billingPeriod: selectedBillingPeriod, uniqueCode: selectedUniqueCode,
      plan: "premium", paymentMethod: "manual_qris", status: "pending", createdAt: Timestamp.fromDate(createdAt), expiresAt: Timestamp.fromDate(expiresAt),
      updatedAt: serverTimestamp(),
    };
    // Generate an unguessable document ID locally. A preflight getDoc() on a
    // missing order is denied by rules that only permit reading owned orders.
    const orderRef = doc(collection(db, "payment_orders"));
    const orderId = orderRef.id;
    paymentStep = "menyiapkan QRIS dinamis";
    await openPaymentOrder(order, orderId, { deferCountdown: true, failCheckoutOnQrError: true });
    paymentStep = "menyimpan dokumen payment_orders";
    await setDoc(orderRef, order, { merge: false });
    startPaymentCountdown(order.expiresAt);
    message.textContent = "Pembayaran berhasil dibuat. Selesaikan pemindaian QRIS sebelum batas waktu.";
  } catch (error) {
    console.error("Gagal membuat pembayaran:", error);
    const errorMessage = error.code === "permission-denied"
      ? `Firestore menolak ${paymentStep} (permission-denied). Pastikan rules payment_orders terbaru sudah dipublikasikan pada project sppg-smart.`
      : error.message || "Pembayaran belum berhasil dibuat. Periksa koneksi dan coba lagi.";
    if (document.getElementById("paymentDialog") && !document.getElementById("paymentDialog").classList.contains("hidden")) closePaymentDialog();
    activePaymentOrder = null;
    showPaymentAlert(error.code === "permission-denied" ? "Pembayaran tidak dapat dibuat" : "QRIS belum siap", errorMessage, "error");
  } finally {
    if (!activePaymentOrder) {
      button.disabled = false;
      button.innerHTML = 'Buat pembayaran <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
    }
  }
}

document.getElementById("checkoutButton").addEventListener("click", () => {
  const cancelled = activePaymentOrder?.status === "cancelled" || activePaymentOrder?.status === "canceled";
  if (activePaymentOrder && !cancelled && parseAccountDate(activePaymentOrder.expiresAt)?.getTime() > Date.now()) {
    const terminal = ["paid", "successful", "succeeded"].includes(activePaymentOrder.status);
    showPaymentAlert(terminal ? "Pembayaran sudah diproses" : "Pembayaran masih aktif", terminal
      ? "Pesanan baru dapat dibuat setelah masa 24 jam pada transaksi ini berakhir."
      : "Selesaikan transaksi yang sedang aktif atau tunggu hingga masa pembayaran 24 jam berakhir.", "warning");
    return;
  }
  activePaymentOrder = null;
  if (!document.getElementById("paymentDialog").classList.contains("hidden")) closePaymentDialog();
  document.getElementById("qrisPaymentDetails").classList.add("hidden");
  document.querySelectorAll("[data-billing-period]").forEach((item) => item.disabled = false);
  requestCheckout();
});
document.getElementById("copyDomainButton")?.addEventListener("click", async () => {
  const domain = document.getElementById("profileDomain").textContent.trim();
  const message = document.getElementById("copyDomainMessage");
  if (!domain || domain === "-") { message.textContent = "Domain belum tersedia."; return; }
  try {
    await navigator.clipboard.writeText(domain);
    message.textContent = "Domain berhasil disalin.";
  } catch {
    message.textContent = `Domain: ${domain}`;
  }
});
document.getElementById("refreshPayments").addEventListener("click", async (event) => {
  const button = event.currentTarget; button.disabled = true; button.innerHTML = '<span class="loading-indicator loading-indicator-small" aria-hidden="true"></span> Memeriksa';
  try {
    await refreshPaymentStatus?.();
    document.getElementById("checkoutMessage").textContent = "Status pembayaran sudah diperbarui.";
  } catch (error) { document.getElementById("checkoutMessage").textContent = "Status pembayaran belum dapat diperiksa. Coba lagi sebentar."; console.error(error); }
  finally { button.disabled = false; button.innerHTML = '<svg class="refresh-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4.8 9A7.5 7.5 0 0 1 18 6.5L20 12M4 17v-5h5m10.2 3A7.5 7.5 0 0 1 6 17.5L4 12"/></svg><span>Perbarui status</span>'; }
});

onAuthStateChanged(auth, async (user) => {
  const loadVersion = ++accountLoadVersion;
  unsubscribePaymentRequests?.();
  unsubscribePaymentRequests = null;
  unsubscribeDemoPackage?.();
  unsubscribeDemoPackage = null;
  observedPaymentOrderStatuses = new Map();
  paymentOrderSnapshotInitialized = false;
  demoPackageSettingsLoaded = false;
  demoPackageVisible = false;
  refreshPaymentStatus = null;
  card.classList.add("hidden");
  errorBox.classList.add("hidden");
  signOutButton.classList.toggle("hidden", !user);
  if (!user) {
    showError("Anda belum login.");
    return;
  }

  loading.classList.remove("hidden");
  subscribeDemoPackageSettings();
  try {
    const email = String(user.email || "").trim().toLowerCase();
    activeUserEmail = email;
    if (!email) throw new Error("Akun Google tidak memiliki email.");
    const accountRef = doc(db, accountCollection, email);
    const snapshot = await getDoc(accountRef);
    if (!snapshot.exists()) throw new Error("Akun belum terdaftar. Silakan daftar kembali dari landing page.");
    const account = snapshot.data();
    if (
      account.active !== true
    ) {
      throw new Error("Akun belum aktif atau tidak memiliki akses ke web SPPG.");
    }
    if (loadVersion !== accountLoadVersion) return;
    renderNotificationCenter(account);
    if (email === controlAdminEmail && account.role === "super_admin") {
      window.location.replace("./admin.html");
      return;
    }

    const accountExpiry = parseAccountDate(account.premiumExpiresAt);
    const isPremium = account.plan === "premium" && (!accountExpiry || accountExpiry.getTime() > Date.now());
    const premiumExpired = account.plan === "premium" && Boolean(accountExpiry && accountExpiry.getTime() <= Date.now());
    const name = account.displayName || account.name || user.displayName || "Pengguna SPPG";
    const sidebarName = document.getElementById("sidebarCustomerName");
    const sidebarEmail = document.getElementById("sidebarCustomerEmail");
    const sidebarMark = document.getElementById("sidebarCustomerMark");
    document.querySelector(".console-sidebar-user")?.classList.remove("hidden");
    document.querySelector(".console-sidebar-user")?.classList.add("flex");
    if (sidebarName) sidebarName.textContent = name;
    if (sidebarEmail) sidebarEmail.textContent = email;
    if (sidebarMark) sidebarMark.textContent = name.trim().slice(0, 2).toUpperCase();
    const createdAt = account.createdAt || account.registeredAt;
    const createdAtLabel = formatAccountDateTime(createdAt);
    const expiresAtLabel = formatAccountDateTime(account.premiumExpiresAt);
    document.getElementById("sidebarCreatedAt").textContent = createdAtLabel;
    document.getElementById("sidebarExpiresAt").textContent = expiresAtLabel;
    document.getElementById("dashboardCreatedAt").textContent = createdAtLabel;
    document.getElementById("dashboardExpiresAt").textContent = expiresAtLabel;
    document.getElementById("welcomeName").textContent = `, ${name}`;
    document.getElementById("profileName").textContent = name;
    document.getElementById("profileEmail").textContent = account.email || user.email || "-";
    document.getElementById("profilePremiumPaidAt").textContent = formatAccountDateTime(account.planUpdatedAt || account.premiumPaidAt);
    document.getElementById("profilePremiumExpiresAt").textContent = formatAccountDateTime(account.premiumExpiresAt);
    document.getElementById("profileWebsite").textContent = account.websiteName || "-";
    document.getElementById("profileDomain").textContent = account.domainName || "-";
    document.getElementById("profileProject").textContent = account.tenantProjectId || (isPremium ? "Sedang disiapkan" : "Belum disiapkan");
    document.getElementById("profileFirebaseStatus").textContent = firebaseStatusLabel(tenantFirebaseStatus(account), isPremium);
    renderWebsiteTimeline(account);
    document.getElementById("websitePremiumExpiresAt").textContent = formatAccountDateTime(account.websiteExpiresAt || account.premiumExpiresAt);
    renderPremiumExpiry(account);
    document.getElementById("dashboardPlan").textContent = isPremium ? "Premium" : premiumExpired ? "Premium berakhir" : "Paket Gratis";
    document.getElementById("dashboardDomain").textContent = account.domainName || "Belum dipilih";
    document.getElementById("planPill").textContent = isPremium ? "Premium" : premiumExpired ? "Premium berakhir" : "Paket Gratis";
    document.getElementById("planPill").classList.toggle("premium-pill", isPremium || premiumExpired);

    const summary = document.getElementById("planSummary");
    summary.classList.toggle("premium-summary", isPremium);
    summary.textContent = premiumExpired
      ? "Masa aktif Premium Anda sudah berakhir. Buat pembayaran QRIS untuk mengaktifkan layanan kembali."
      : isPremium
      ? "Paket Premium aktif — modul aplikasi tersedia sesuai role akun Anda."
      : "Paket Gratis aktif — akun Anda dapat melihat profil. Fitur pengelolaan lengkap tersedia pada Premium (Rp150.000/bulan atau Rp1.100.000/tahun).";
    document.getElementById("premiumActions").classList.toggle("hidden", !isPremium);
    unsubscribePaymentRequests = onSnapshot(query(collection(db, "payment_orders"), where("email", "==", email)), (snapshot) => {
      const history = document.getElementById("paymentHistory");
      const list = document.getElementById("paymentList");
      if (!history || !list) return;
      history.classList.remove("hidden");
      list.replaceChildren();
      const orders = snapshot.docs.map((payment) => ({ ...payment.data(), id: payment.id }));
      const successfulStatuses = new Set(["paid", "successful", "succeeded"]);
      const newlyPaidOrder = paymentOrderSnapshotInitialized
        ? orders.find((order) => {
            const previousStatus = observedPaymentOrderStatuses.get(order.id);
            return successfulStatuses.has(order.status)
              && (previousStatus === "pending" || (activePaymentOrder?.id === order.id && activePaymentOrder.status === "pending"));
          })
        : null;
      observedPaymentOrderStatuses = new Map(orders.map((order) => [order.id, order.status]));
      paymentOrderSnapshotInitialized = true;
      latestPaymentOrders = orders;
      paymentOrdersLoaded = true;
      if (newlyPaidOrder) {
        activePaymentOrder = { ...newlyPaidOrder };
        clearInterval(paymentCountdownTimer);
        if (!document.getElementById("paymentDialog")?.classList.contains("hidden")) closePaymentDialog();
        const periodLabel = newlyPaidOrder.billingPeriod === "demo_10m" ? "Paket Demo 10 Menit aktif selama 10 menit" : `Paket Premium ${newlyPaidOrder.billingPeriod === "yearly" ? "tahunan" : "bulanan"} Anda sekarang aktif`;
        showPaymentAlert("Pembayaran berhasil", `${periodLabel}. Pembayaran ${rupiah.format(newlyPaidOrder.amount || 0)} telah diverifikasi.`, "success");
        refreshPaymentStatus?.().catch((error) => console.warn("Status paket belum dapat diperbarui:", error));
      }
      renderNotificationCenter(account, orders);
      if (snapshot.empty) {
        const empty = document.createElement("p"); empty.className = "payment-empty"; empty.textContent = "Belum ada riwayat pembayaran. Pilih paket lalu tekan Buat pembayaran untuk mendapatkan QRIS."; list.append(empty); return;
      }
      const orderedDocs = [...snapshot.docs].sort((a, b) => new Date(b.data().createdAt || 0).getTime() - new Date(a.data().createdAt || 0).getTime());
      const blockingOrder = orderedDocs.find((item) => {
        const request = item.data();
        const expiry = parseAccountDate(request.expiresAt)?.getTime();
        return ["pending", "paid", "successful", "succeeded"].includes(request.status) && Number.isFinite(expiry) && expiry > Date.now();
      });
      const liveOrder = blockingOrder?.data().status === "pending" ? blockingOrder : null;
      const createButton = document.getElementById("checkoutButton");
      if (blockingOrder && createButton && !activePaymentOrder) {
        createButton.disabled = false;
        createButton.textContent = blockingOrder.data().status === "pending" ? "Pembayaran masih aktif" : "Pembayaran sudah diproses";
        document.getElementById("checkoutMessage").textContent = "";
      }
      if (liveOrder && !activePaymentOrder) openPaymentOrder(liveOrder.data(), liveOrder.id).catch((error) => console.error("Gagal membuka detail order:", error));
      for (const item of orderedDocs) {
        const request = item.data();
        const expired = request.status === "pending" && new Date(request.expiresAt || 0).getTime() <= Date.now();
        const row = document.createElement("article"); row.className = "payment-row";
        const details = document.createElement("div"); details.className = "payment-row-details";
        const periodLabel = request.billingPeriod === "demo_10m" ? "Demo 10 Menit" : request.billingPeriod === "yearly" ? "1 Tahun" : "1 Bulan";
        const title = document.createElement("strong"); title.textContent = `QRIS Premium ${periodLabel} · ${rupiah.format(request.amount || 150000)}`;
        const id = document.createElement("span"); id.textContent = `Nomor pesanan: ${item.id}`;
        const methodLabels = { manual_qris: "QRIS", bank_mandiri: "Bank Mandiri", bank_bsi: "BSI", bank_bni: "BNI", bank_bca: "BCA", bank_bri: "BRI", bank_sumselbabel: "Bank Sumsel Babel", ewallet_dana: "DANA", ewallet_gopay: "GoPay", ewallet_ovo: "OVO", ewallet_shopeepay: "ShopeePay" };
        const method = document.createElement("span"); method.textContent = `Metode: ${methodLabels[request.paymentMethod] || "QRIS"}`;
        const date = document.createElement("span"); date.className = "payment-row-date"; date.textContent = `Dibuat ${formatAccountDateTime(request.createdAt)} · bayar sebelum ${formatAccountDateTime(request.expiresAt)}`;
        details.append(title, id, method, date);
        const status = document.createElement("button"); status.type = "button"; status.className = `payment-status payment-status-${expired ? "expired" : request.status}`;
        status.textContent = expired || request.status === "expired" ? "Kedaluwarsa · detail" : ({ pending: "Menunggu pembayaran · buka", paid: "Lunas · detail", successful: "Berhasil · detail", succeeded: "Berhasil · detail", cancelled: "Dibatalkan · detail", failed: "Gagal · detail", expired: "Kedaluwarsa · detail" })[request.status] || "Lihat pesanan";
        status.addEventListener("click", () => openPaymentOrder(request, item.id).catch((error) => console.error("Gagal membuka detail order:", error)));
        row.append(details, status); row.tabIndex = 0; row.setAttribute("role", "button"); row.setAttribute("aria-label", `Buka pembayaran ${item.id}`);
        row.addEventListener("click", (event) => { if (event.target !== status) openPaymentOrder(request, item.id).catch((error) => console.error("Gagal membuka detail order:", error)); });
        row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPaymentOrder(request, item.id).catch((error) => console.error("Gagal membuka detail order:", error)); } });
        list.append(row);
      }
    }, (error) => {
      console.warn("Riwayat pembayaran tidak dapat dimuat:", error);
      const list = document.getElementById("paymentList");
      if (list) list.textContent = error.code === "permission-denied"
        ? "Firestore menolak akses riwayat pesanan. Publikasikan aturan payment_orders terbaru, lalu muat ulang halaman."
        : `Riwayat pembayaran belum dapat dimuat. ${error.message || "Periksa koneksi lalu coba lagi."}`;
    });
    refreshPaymentStatus = async () => {
      const latest = await getDoc(doc(db, accountCollection, activeUserEmail));
      if (latest.exists()) {
        const latestAccount = latest.data();
        const latestExpiry = parseAccountDate(latestAccount.premiumExpiresAt);
        const latestIsPremium = latestAccount.plan === "premium" && (!latestExpiry || latestExpiry.getTime() > Date.now());
        renderPremiumExpiry(latestAccount);
        const latestWebsiteReady = isWebsiteAvailable(latestAccount, latestIsPremium);
        document.getElementById("websitePremiumExpiresAt").textContent = formatAccountDateTime(latestAccount.websiteExpiresAt || latestAccount.premiumExpiresAt);
        document.getElementById("profileProject").textContent = latestAccount.tenantProjectId || (latestIsPremium ? "Sedang disiapkan" : "Belum disiapkan");
        document.getElementById("profileFirebaseStatus").textContent = firebaseStatusLabel(tenantFirebaseStatus(latestAccount), latestIsPremium);
        renderWebsiteTimeline(latestAccount);
        const latestWebsiteExpiry = parseAccountDate(latestAccount.websiteExpiresAt || latestAccount.premiumExpiresAt);
        document.getElementById("profileWebsiteStatus").textContent = latestWebsiteExpiry && latestWebsiteExpiry.getTime() <= Date.now() ? "Masa berlaku berakhir" : latestAccount.hostingStatus === "ready" ? "Siap" : latestAccount.hostingStatus === "configuring" ? "Dikonfigurasi" : latestAccount.hostingStatus === "preparing" ? "Sedang disiapkan" : "Belum disiapkan";
        document.getElementById("profilePremiumExpiresAt").textContent = formatAccountDateTime(latestAccount.premiumExpiresAt);
        document.getElementById("sidebarExpiresAt").textContent = formatAccountDateTime(latestAccount.premiumExpiresAt);
        document.getElementById("dashboardExpiresAt").textContent = formatAccountDateTime(latestAccount.premiumExpiresAt);
        document.getElementById("premiumActions").classList.toggle("hidden", !latestWebsiteReady);
        const websiteLink = document.getElementById("websiteLink");
        websiteLink.href = latestWebsiteReady ? latestAccount.websiteUrl : "#";
        websiteLink.classList.toggle("hidden", !latestWebsiteReady);
        if (latestIsPremium) {
          document.getElementById("planPill").textContent = "Premium";
          document.getElementById("planPill").classList.add("premium-pill");
          document.getElementById("checkoutPanel").classList.add("hidden");
          document.getElementById("dashboardPlan").textContent = "Premium";
          document.getElementById("planSummary").textContent = "Pembayaran terverifikasi. Paket Premium aktif dan website sedang disiapkan.";
          document.getElementById("profilePremiumPaidAt").textContent = formatAccountDateTime(latestAccount.planUpdatedAt || latestAccount.premiumPaidAt);
        }
      }
    };
    const hostingStatus = account.hostingStatus || (isPremium ? "preparing" : "not_purchased");
    const dashboardStatusLabels = { not_purchased: "Belum disiapkan", preparing: "Sedang disiapkan", configuring: "Sedang dikonfigurasi", ready: "Siap" };
    const websiteStatusLabel = premiumExpired ? "Paket berakhir" : isPremium && hostingStatus === "not_purchased" ? "Sedang disiapkan" : dashboardStatusLabels[hostingStatus] || (isPremium ? "Sedang disiapkan" : "Belum disiapkan");
    document.getElementById("dashboardWebsiteStatus").textContent = websiteStatusLabel;
    const firebaseStatus = tenantFirebaseStatus(account);
    const websiteExpiry = parseAccountDate(account.websiteExpiresAt || account.premiumExpiresAt);
    const websiteExpired = Boolean(websiteExpiry && websiteExpiry.getTime() <= Date.now());
    document.getElementById("profileFirebaseStatus").textContent = firebaseStatusLabel(firebaseStatus, isPremium);
    document.getElementById("websitePremiumExpiresAt").textContent = formatAccountDateTime(account.websiteExpiresAt || account.premiumExpiresAt);
    document.getElementById("profileWebsiteStatus").textContent = websiteExpired ? "Masa berlaku berakhir" : isPremium && hostingStatus === "not_purchased" ? "Sedang disiapkan" : dashboardStatusLabels[hostingStatus] || (isPremium ? "Sedang disiapkan" : "Belum disiapkan");
    const statusMessages = {
      not_purchased: "Paket Gratis aktif. Setelah membeli Premium, administrator akan menyiapkan website dan Firebase khusus untuk akun Anda.",
      preparing: "Pembelian Premium Anda sudah tercatat. Website dan Firebase sedang disiapkan oleh administrator. Kami akan memberi tahu Anda saat website siap.",
      configuring: "Website dan Firebase Anda sedang dikonfigurasi. Kami akan memberi tahu Anda saat website siap.",
      ready: "Website Anda sudah siap. Silakan buka website melalui tombol di bawah.",
    };
    summary.textContent = isPremium ? (statusMessages[hostingStatus] || statusMessages.preparing) : statusMessages.not_purchased;
    if (isPremium && websiteExpired) summary.textContent = "Masa berlaku website sudah berakhir. Hubungi admin untuk memperpanjang layanan.";
    const websiteIsReady = isWebsiteAvailable(account, isPremium);
    document.getElementById("premiumActions").classList.toggle("hidden", !websiteIsReady);
    const websiteLink = document.getElementById("websiteLink");
    websiteLink.href = websiteIsReady ? account.websiteUrl : "#";
    websiteLink.classList.toggle("hidden", !websiteIsReady);
    document.getElementById("adminActions").classList.toggle(
      "hidden",
      account.role !== "super_admin" || email !== controlAdminEmail,
    );
    loading.classList.add("hidden");
    card.classList.remove("hidden");
  } catch (error) {
    if (loadVersion !== accountLoadVersion) return;
    showError(`Profil tidak dapat dimuat: ${error.message}`);
  }
});
