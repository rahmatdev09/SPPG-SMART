import { onAuthStateChanged, signInWithPopup, signInWithPopup as signInWithPopupForAppUsers, signOut, GoogleAuthProvider, getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { collection, onSnapshot, doc, writeBatch, getDoc, updateDoc, setDoc, serverTimestamp, Timestamp, getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { accountCollection, auth, controlAdminEmail, db, googleProvider } from "./firebase.js";

// Main MBG application project shown in its Firebase Console (projectId sppg-abc46).
// Creating a Super Admin document requires a Google session authorized by that project's rules.
const mbgUsersApp = initializeApp({
  apiKey: "AIzaSyBQT1R5HhePD7XPIE48aZXMcC58JrL6cPk",
  authDomain: "sppg-abc46.firebaseapp.com",
  projectId: "sppg-abc46",
  storageBucket: "sppg-abc46.firebasestorage.app",
  messagingSenderId: "1067084887190",
  appId: "1:1067084887190:web:c5948ee1cdfa525aabbeb7",
  measurementId: "G-XB8CPB6YR6",
}, "mbg-admin-users");
const mbgUsersAuth = getAuth(mbgUsersApp);
const mbgUsersDb = getFirestore(mbgUsersApp);
const mbgUsersProvider = new GoogleAuthProvider();

async function addSuperAdminToProject({ projectLabel, email, projectDb, projectAuth, provider }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Email Super Admin wajib diisi.");

  let adminUser = projectAuth.currentUser;
  if (!adminUser) {
    const result = await signInWithPopupForAppUsers(projectAuth, provider);
    adminUser = result.user;
  }
  const actingEmail = String(adminUser.email || "").trim().toLowerCase();
  if (!actingEmail) throw new Error(`Akun Google untuk ${projectLabel} tidak memiliki email.`);
  const actingAccountRef = doc(projectDb, "app_users", actingEmail);
  const actingAccount = await getDoc(actingAccountRef);
  if (!actingAccount.exists() || actingAccount.data().active !== true || actingAccount.data().role !== "super_admin") {
    throw new Error(`Akun ${actingEmail} tidak memiliki role Super Admin aktif pada ${projectLabel}.`);
  }

  const targetRef = doc(projectDb, "app_users", normalizedEmail);
  if (normalizedEmail === actingEmail) return;
  const targetSnapshot = await getDoc(targetRef);
  const now = new Date().toISOString();
  await setDoc(targetRef, {
    email: normalizedEmail,
    role: "super_admin",
    active: true,
    updatedAt: now,
    ...(targetSnapshot.exists() ? {} : { createdAt: now, createdBy: actingEmail }),
  }, { merge: true });
}

function getTenantFirebaseServices(config) {
  const appName = `customer-${String(config.projectId).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const existingApp = getApps().find((item) => item.name === appName);
  const tenantApp = existingApp || initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    ...(config.storageBucket ? { storageBucket: config.storageBucket } : {}),
    ...(config.messagingSenderId ? { messagingSenderId: config.messagingSenderId } : {}),
    appId: config.appId,
    ...(config.measurementId ? { measurementId: config.measurementId } : {}),
  }, appName);
  return {
    db: getFirestore(tenantApp),
    auth: getAuth(tenantApp),
    provider: new GoogleAuthProvider(),
  };
}

async function addMbgSuperAdmin(email) {
  return addSuperAdminToProject({
    projectLabel: "project MBG sppg-abc46",
    email,
    projectDb: mbgUsersDb,
    projectAuth: mbgUsersAuth,
    provider: mbgUsersProvider,
  });
}

async function addCustomerProjectSuperAdmin(config) {
  const { db: tenantDb, auth: tenantAuth, provider } = getTenantFirebaseServices(config);
  return addSuperAdminToProject({
    projectLabel: `project website customer ${config.projectId}`,
    email: config.superAdminEmail,
    projectDb: tenantDb,
    projectAuth: tenantAuth,
    provider,
  });
}

const loading = document.getElementById("adminLoading");
const panel = document.getElementById("adminDashboard");
const errorBox = document.getElementById("adminError");
const signOutButton = document.getElementById("adminSignOut");
let unsubscribeUsers = null;
let firebaseConfigAccount = null;
let customerSearchTerm = "";
let customersPage = 1;
let unsubscribePaymentRequests = null;
let unsubscribePaymentOrders = null;
let dashboardCustomers = [];
let dashboardPaymentRequests = [];

document.getElementById("saveDemoPackageSetting")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const checkbox = document.getElementById("demoPackageVisible");
  const status = document.getElementById("demoPackageSettingStatus");
  button.disabled = true;
  status.textContent = "Menyimpan...";
  try {
    await setDoc(doc(db, "public_settings", "demo_package"), {
      demoVisible: checkbox.checked,
      updatedAt: serverTimestamp(),
      updatedBy: String(auth.currentUser?.email || "").trim().toLowerCase(),
    }, { merge: true });
    status.textContent = checkbox.checked ? "Paket demo ditampilkan." : "Paket demo disembunyikan.";
  } catch (error) {
    status.textContent = error.code === "permission-denied" ? "Akses ditolak. Pastikan aturan public_settings terbaru sudah dipublikasikan." : `Gagal menyimpan: ${error.message}`;
  } finally { button.disabled = false; }
});

function showError(message, offerLogin = false) {
  errorBox.replaceChildren(document.createTextNode(message));
  if (offerLogin) {
    const button = document.createElement("button");
    button.className = "inline-link";
    button.type = "button";
    button.textContent = " Login dengan Google";
    button.onclick = () => signInWithPopup(auth, googleProvider).catch((error) => showError(error.message, true));
    errorBox.append(button);
  }
  errorBox.classList.remove("hidden"); loading.classList.add("hidden"); panel.classList.add("hidden");
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return ["https:", "http:"].includes(parsed.protocol) && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function isOnlineDomain(value) {
  return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.online$/.test(String(value || "").trim().toLowerCase());
}

function parseWebsiteInput(value) {
  const websiteUrl = String(value || "").trim();
  if (!isHttpUrl(websiteUrl)) return { websiteName: "", domainName: "", websiteUrl };
  const parsed = new URL(websiteUrl);
  const domainName = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const label = domainName.split(".")[0] || "";
  const websiteName = label.replace(/[-_]+/g, " ").replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  return { websiteName, domainName, websiteUrl };
}

function dateInputValue(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function formatAdminDate(value) {
  const normalized = dateInputValue(value);
  if (!normalized) return "—";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${normalized}T00:00:00Z`));
}

function toAdminDate(value) {
  const date = value?.toDate?.() || (value instanceof Date ? value : value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function renderMonthlyChart(elementId, values, formatValue) {
  const chart = document.getElementById(elementId);
  const maxValue = Math.max(1, ...values.map((point) => point.value));
  chart.replaceChildren();
  for (const point of values) {
    const column = document.createElement("div"); column.className = "admin-bar-chart-column";
    const value = document.createElement("span"); value.className = "admin-bar-chart-value"; value.textContent = formatValue(point.value);
    const track = document.createElement("div"); track.className = "admin-bar-chart-track";
    const bar = document.createElement("span"); bar.className = "admin-bar-chart-bar";
    bar.style.height = `${point.value ? Math.max(7, point.value / maxValue * 76) : 2}px`;
    bar.title = `${point.label}: ${formatValue(point.value)}`;
    track.append(bar);
    const label = document.createElement("span"); label.className = "admin-bar-chart-label"; label.textContent = point.label;
    column.append(value, track, label); chart.append(column);
  }
}

function renderDashboardCharts() {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    return { year: date.getFullYear(), month: date.getMonth(), label: new Intl.DateTimeFormat("id-ID", { month: "short" }).format(date), value: 0 };
  });
  for (const account of dashboardCustomers) {
    const date = toAdminDate(account.createdAt || account.registeredAt);
    const point = date && months.find((month) => month.year === date.getFullYear() && month.month === date.getMonth());
    if (point) point.value += 1;
  }
  const usersTotal = months.reduce((sum, point) => sum + point.value, 0);
  const revenueMonths = months.map((point) => ({ ...point, value: 0 }));
  for (const request of dashboardPaymentRequests) {
    if (request.status !== "received") continue;
    const date = toAdminDate(request.reviewedAt || request.updatedAt || request.createdAt);
    const point = date && revenueMonths.find((month) => month.year === date.getFullYear() && month.month === date.getMonth());
    if (point) point.value += Number(request.amount) || 0;
  }
  const revenueTotal = revenueMonths.reduce((sum, point) => sum + point.value, 0);
  document.getElementById("userGrowthTotal").textContent = `${usersTotal} akun`;
  document.getElementById("revenueTotal").textContent = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(revenueTotal);
  renderMonthlyChart("userGrowthChart", months, (value) => String(value));
  renderMonthlyChart("revenueChart", revenueMonths, (value) => value ? new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(value) : "0");
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Foto tidak dapat dibaca."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("File foto tidak valid."));
      image.onload = () => {
        // Customer brand marks are displayed in round avatars, so normalize
        // every upload to a square center crop before compression.
        const sourceSize = Math.min(image.width, image.height);
        const sourceX = Math.round((image.width - sourceSize) / 2);
        const sourceY = Math.round((image.height - sourceSize) / 2);
        let maxDimension = 1200;
        let quality = 0.72;
        while (maxDimension >= 480) {
          const outputSize = Math.max(1, Math.min(sourceSize, maxDimension));
          const canvas = document.createElement("canvas");
          canvas.width = outputSize;
          canvas.height = outputSize;
          canvas.getContext("2d").drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, outputSize, outputSize);
          const compressed = canvas.toDataURL("image/jpeg", quality);
          if (compressed.length <= 900000) return resolve(compressed);
          if (quality > 0.52) quality -= 0.1;
          else { maxDimension = Math.floor(maxDimension * 0.8); quality = 0.68; }
        }
        reject(new Error("Foto terlalu besar untuk dipublikasikan. Pilih foto lain dengan ukuran lebih kecil."));
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

signOutButton.addEventListener("click", () => signOut(auth).catch((error) => showError(error.message)));

function closeFirebaseConfigModal() {
  document.getElementById("firebaseConfigModal").classList.add("hidden");
  const configError = document.getElementById("tenantConfigError");
  configError.classList.add("hidden");
  configError.textContent = "";
  firebaseConfigAccount = null;
}

function showFirebaseConfigError(message) {
  const configError = document.getElementById("tenantConfigError");
  configError.textContent = message;
  configError.classList.remove("hidden");
}

function openFirebaseConfigModal(account) {
  firebaseConfigAccount = account;
  const config = account.tenantFirebaseConfig || {};
  document.getElementById("firebaseConfigCustomer").textContent = `${account.websiteName || "Website"} · ${account.email || account.id}`;
  document.getElementById("tenantApiKey").value = config.apiKey || "";
  document.getElementById("tenantAuthDomain").value = config.authDomain || "";
  document.getElementById("tenantSuperAdminEmail").value = config.superAdminEmail || "";
  document.getElementById("tenantProjectId").value = config.projectId || account.tenantProjectId || "";
  document.getElementById("tenantStorageBucket").value = config.storageBucket || "";
  document.getElementById("tenantMessagingSenderId").value = config.messagingSenderId || "";
  document.getElementById("tenantAppId").value = config.appId || "";
  document.getElementById("tenantMeasurementId").value = config.measurementId || "";
  document.getElementById("firebaseConfigModal").classList.remove("hidden");
  document.getElementById("tenantApiKey").focus();
}

document.getElementById("closeFirebaseModal").addEventListener("click", closeFirebaseConfigModal);
document.getElementById("cancelFirebaseConfig").addEventListener("click", closeFirebaseConfigModal);
document.getElementById("firebaseConfigModal").addEventListener("click", (event) => {
  if (event.target.id === "firebaseConfigModal") closeFirebaseConfigModal();
});
function closeCustomerEditModal() {
  document.getElementById("customerEditModal").classList.add("hidden");
  document.getElementById("customerEditSlot").replaceChildren();
}
document.getElementById("closeCustomerEdit").addEventListener("click", closeCustomerEditModal);
document.getElementById("customerEditModal").addEventListener("click", (event) => {
  if (event.target.id === "customerEditModal") closeCustomerEditModal();
});
function closeCustomerViewModal() {
  document.getElementById("customerViewModal").classList.add("hidden");
}
document.getElementById("closeCustomerView").addEventListener("click", closeCustomerViewModal);
document.getElementById("customerViewModal").addEventListener("click", (event) => {
  if (event.target.id === "customerViewModal") closeCustomerViewModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { closeCustomerEditModal(); closeCustomerViewModal(); }
});
document.getElementById("firebaseConfigForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!firebaseConfigAccount) return;
  const form = event.currentTarget;
  const values = new FormData(form);
  const config = Object.fromEntries(["apiKey", "authDomain", "superAdminEmail", "projectId", "storageBucket", "messagingSenderId", "appId", "measurementId"].map((key) => [key, String(values.get(key) || "").trim()]));
  if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
    return showFirebaseConfigError("Isi API key, Auth domain, Project ID, dan App ID terlebih dahulu.");
  }
  const saveButton = document.getElementById("saveFirebaseConfig");
  saveButton.disabled = true;
  saveButton.innerHTML = '<span class="loading-indicator loading-indicator-small" aria-hidden="true"></span> Menyimpan';
  try {
    await addMbgSuperAdmin(config.superAdminEmail);
    await addCustomerProjectSuperAdmin(config);
    await updateDoc(doc(db, accountCollection, firebaseConfigAccount.id), {
      tenantFirebaseConfig: config,
      tenantProjectId: config.projectId,
      tenantFirebaseStatus: firebaseConfigAccount.tenantFirebaseStatus || "active",
      firebaseConfigUpdatedAt: new Date().toISOString(),
    });
    closeFirebaseConfigModal();
  } catch (error) {
    showFirebaseConfigError(`Konfigurasi Firebase gagal disimpan: ${error.message}`);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Simpan konfigurasi";
  }
});

function switchAdminView() {
  const customersActive = window.location.hash === "#customers";
  const paymentsActive = window.location.hash === "#payments";
  document.getElementById("overview").classList.toggle("hidden", customersActive || paymentsActive);
  document.getElementById("customers").classList.toggle("hidden", !customersActive);
  document.getElementById("payments").classList.toggle("hidden", !paymentsActive);
  document.querySelectorAll(".admin-nav-link[href^='#']").forEach((link) => {
    link.classList.toggle("active", link.hash === (customersActive ? "#customers" : paymentsActive ? "#payments" : "#overview"));
  });
}
window.addEventListener("hashchange", switchAdminView);
switchAdminView();

function renderPaymentRequests(snapshot) {
  const target = document.getElementById("paymentRequestList");
  const summary = document.getElementById("paymentAdminSummary");
  const pending = snapshot.docs.filter((item) => item.data().status === "pending").length;
  dashboardPaymentRequests = snapshot.docs.map((item) => item.data());
  renderDashboardCharts();
  summary.textContent = `${pending} pengajuan menunggu verifikasi · ${snapshot.size} total pengajuan QRIS`;
  target.replaceChildren();
  if (snapshot.empty) {
    const empty = document.createElement("div"); empty.className = "empty-row"; empty.textContent = "Belum ada pengajuan pembayaran."; target.append(empty); return;
  }
  for (const item of snapshot.docs) {
    const request = item.data();
    const validTransferRequest = ["manual_qris", "manual_bsi_transfer"].includes(request.paymentMethod) && typeof request.proofDataUrl === "string" && request.proofDataUrl.startsWith("data:image/jpeg;base64,");
    const card = document.createElement("article"); card.className = "payment-request-card";
    const info = document.createElement("div"); info.className = "payment-request-info";
    const name = document.createElement("strong"); name.textContent = request.displayName || request.email || "Pelanggan";
    const meta = document.createElement("span"); meta.textContent = `${request.email || "-"} · ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(request.amount || 150000)}`;
    const billingLabel = request.billingPeriod === "yearly" ? "Paket 1 tahun" : "Paket 1 bulan";
    const period = document.createElement("small"); period.textContent = `${billingLabel}${request.uniqueCode ? ` · kode unik ${request.uniqueCode}` : ""}`;
    const note = document.createElement("small"); note.textContent = `Nama pada pembayaran: ${request.note || "Tidak dicantumkan"}`;
    const submittedAt = document.createElement("small");
    submittedAt.className = "payment-request-time";
    submittedAt.textContent = `Diajukan: ${formatPaymentTimestamp(request.createdAt)}`;
    info.append(name, meta, period, note, submittedAt);
    if (request.reviewedAt) {
      const reviewedAt = document.createElement("small");
      reviewedAt.className = "payment-request-time";
      reviewedAt.textContent = `Ditinjau: ${formatPaymentTimestamp(request.reviewedAt)}${request.reviewedBy ? ` · ${request.reviewedBy}` : ""}`;
      info.append(reviewedAt);
    }
    if (typeof request.proofDataUrl === "string" && request.proofDataUrl.startsWith("data:image/")) {
      const proofButton = document.createElement("button"); proofButton.type = "button"; proofButton.className = "payment-proof-view"; proofButton.textContent = "Lihat bukti";
      proofButton.addEventListener("click", () => openPaymentProof(request.proofDataUrl, request.note || request.email || "Pelanggan"));
      info.append(proofButton);
    }
    const badge = document.createElement("span"); badge.className = `payment-request-status status-${request.status || "pending"}`; badge.textContent = !validTransferRequest ? "Pengajuan lama / tidak valid" : ({ pending: "Menunggu verifikasi", received: "Terverifikasi", rejected: "Ditolak" })[request.status] || request.status || "Menunggu";
    badge.classList.add("payment-request-status-top");
    const actions = document.createElement("div"); actions.className = "payment-request-actions";
    if (request.status === "pending" && validTransferRequest) for (const [status, label] of [["received", "Setujui"], ["rejected", "Tolak"]]) {
      const button = document.createElement("button"); button.type = "button"; button.className = "button button-config"; button.textContent = label;
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.innerHTML = '<span class="loading-indicator loading-indicator-small" aria-hidden="true"></span> Memproses';
        try {
          if (status === "received") {
            const accountRef = doc(db, accountCollection, request.email);
            const approvedAt = new Date();
            const accountSnapshot = await getDoc(accountRef);
            const currentExpiry = accountSnapshot.exists() && accountSnapshot.data().plan === "premium" ? new Date(accountSnapshot.data().premiumExpiresAt || 0) : null;
            const expiryBase = currentExpiry && currentExpiry > approvedAt ? currentExpiry : approvedAt;
            const expiry = new Date(expiryBase);
            if (request.billingPeriod === "yearly") expiry.setFullYear(expiry.getFullYear() + 1);
            else expiry.setDate(expiry.getDate() + 30);
            expiry.setHours(23, 59, 59, 999);
            const batch = writeBatch(db);
            batch.update(accountRef, { plan: "premium", premiumBillingPeriod: request.billingPeriod || "monthly", hostingStatus: "preparing", premiumPaidAt: approvedAt.toISOString(), premiumExpiresAt: expiry.toISOString(), premiumExpiresAtTimestamp: Timestamp.fromDate(expiry), websiteExpiresAt: expiry.toISOString(), planUpdatedAt: approvedAt.toISOString(), hostingUpdatedAt: approvedAt.toISOString() });
            batch.update(doc(db, "payment_requests", item.id), { status, reviewedBy: auth.currentUser?.email || "", reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
            await batch.commit();
          } else {
            await updateDoc(doc(db, "payment_requests", item.id), { status, reviewedBy: auth.currentUser?.email || "", reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
          }
        }
        catch (error) {
          button.disabled = false;
          console.error("Gagal memperbarui pengajuan QRIS:", error);
          const reason = error.code === "permission-denied"
            ? "Akses Firestore ditolak. Publikasikan aturan terbaru dari landing-page/firestore.rules ke project sppg-smart, lalu coba lagi."
            : error.code === "not-found"
              ? "Akun customer tidak ditemukan di app_users. Pastikan email pengajuan sama dengan ID akun customer."
              : error.message;
          showError(`Status pengajuan gagal diperbarui: ${reason}`);
        }
      });
      actions.append(button);
    }
    card.append(info, badge, actions); target.append(card);
  }
}

function renderCustomerPaymentOrders(snapshot) {
  const target = document.getElementById("customerPaymentOrders");
  if (!target) return;
  target.replaceChildren();
  if (snapshot.empty) {
    const empty = document.createElement("div"); empty.className = "empty-row"; empty.textContent = "Belum ada pesanan QRIS."; target.append(empty); return;
  }
  const orders = [...snapshot.docs].sort((a, b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0));
  for (const item of orders) {
    const order = item.data();
    const demo = order.billingPeriod === "demo_10m";
    const expired = order.status === "pending" && (order.expiresAt?.toDate?.()?.getTime?.() || 0) <= Date.now();
    const card = document.createElement("article"); card.className = "payment-request-card";
    const info = document.createElement("div"); info.className = "payment-request-info";
    const name = document.createElement("strong"); name.textContent = order.displayName || order.email || "Pelanggan";
    const details = document.createElement("span"); details.textContent = `${order.email || "-"} · ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(order.amount || 0)}`;
    const packageInfo = document.createElement("small"); packageInfo.textContent = `Paket ${demo ? "Demo 10 menit" : order.billingPeriod === "yearly" ? "1 tahun" : "1 bulan"} · kode unik ${order.uniqueCode || 0}`;
    const created = document.createElement("small"); created.className = "payment-request-time"; created.textContent = `Dibuat ${formatPaymentTimestamp(order.createdAt)} · batas bayar ${formatPaymentTimestamp(order.expiresAt)}`;
    info.append(name, details, packageInfo, created);
    const status = document.createElement("span"); status.className = `payment-request-status status-${expired ? "expired" : order.status || "pending"}`;
    status.textContent = expired ? "Kedaluwarsa" : ({ pending: "Menunggu verifikasi", paid: "Terverifikasi", failed: "Gagal", expired: "Kedaluwarsa", cancelled: "Dibatalkan", successful: "Berhasil", succeeded: "Berhasil" })[order.status] || order.status || "Menunggu";
    status.classList.add("payment-request-status-top");
    const actions = document.createElement("div"); actions.className = "payment-request-actions";
    if (order.status === "pending" && !expired) {
      const approve = document.createElement("button"); approve.type = "button"; approve.className = "button button-config"; approve.textContent = "Verifikasi pembayaran";
      const feedback = document.createElement("small"); feedback.className = "payment-request-time";
      approve.addEventListener("click", async () => {
        approve.disabled = true; approve.textContent = "Memverifikasi...";
        try {
          const currentOrder = await getDoc(doc(db, "payment_orders", item.id));
          if (!currentOrder.exists() || currentOrder.data().status !== "pending") throw new Error("Pesanan sudah diproses atau tidak ditemukan.");
          const currentData = currentOrder.data();
          if ((currentData.expiresAt?.toDate?.()?.getTime?.() || 0) <= Date.now()) throw new Error("Batas pembayaran 24 jam sudah berakhir.");
          const accountRef = doc(db, accountCollection, currentData.email);
          const accountSnapshot = await getDoc(accountRef);
          if (!accountSnapshot.exists()) throw new Error("Akun pelanggan tidak ditemukan.");
          const approvedAt = new Date();
          const account = accountSnapshot.data();
          const activeExpiry = account.premiumExpiresAtTimestamp?.toDate?.() || (account.premiumExpiresAt ? new Date(account.premiumExpiresAt) : null);
          const base = activeExpiry && activeExpiry > approvedAt ? activeExpiry : approvedAt;
          const expiry = new Date(base);
          if (demo) expiry.setTime(approvedAt.getTime() + 10 * 60 * 1000);
          else if (currentData.billingPeriod === "yearly") expiry.setFullYear(expiry.getFullYear() + 1);
          else expiry.setDate(expiry.getDate() + 30);
          if (!demo) expiry.setHours(23, 59, 59, 999);
          const batch = writeBatch(db);
          batch.update(accountRef, {
            plan: "premium", premiumBillingPeriod: currentData.billingPeriod,
            hostingStatus: "preparing", premiumPaidAt: approvedAt.toISOString(),
            premiumExpiresAt: expiry.toISOString(), premiumExpiresAtTimestamp: Timestamp.fromDate(expiry),
            websiteExpiresAt: expiry.toISOString(), planUpdatedAt: approvedAt.toISOString(), hostingUpdatedAt: approvedAt.toISOString(),
          });
          batch.update(doc(db, "payment_orders", item.id), { status: "paid", paidAt: serverTimestamp(), updatedAt: serverTimestamp() });
          await batch.commit();
        } catch (error) {
          approve.disabled = false; approve.textContent = "Verifikasi pembayaran"; feedback.textContent = error.message || "Gagal memverifikasi pembayaran.";
        }
      });
      actions.append(approve, feedback);
    }
    card.append(info, status, actions); target.append(card);
  }
}

function formatPaymentTimestamp(value) {
  const date = value?.toDate?.() || (value instanceof Date ? value : value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return "Waktu tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta",
  }).format(date) + " WIB";
}

function openPaymentProof(imageUrl, customerName) {
  const overlay = document.getElementById("paymentProofModal");
  const image = document.getElementById("paymentProofModalImage");
  const title = document.getElementById("paymentProofModalTitle");
  image.src = imageUrl;
  image.alt = `Bukti pembayaran ${customerName}`;
  title.textContent = `Bukti pembayaran · ${customerName}`;
  overlay.classList.remove("hidden");
}

function closePaymentProof() {
  document.getElementById("paymentProofModal").classList.add("hidden");
  document.getElementById("paymentProofModalImage").removeAttribute("src");
}

document.getElementById("closePaymentProof")?.addEventListener("click", closePaymentProof);
document.getElementById("paymentProofModal")?.addEventListener("click", (event) => {
  if (event.target.id === "paymentProofModal") closePaymentProof();
});
document.getElementById("customerSearch").addEventListener("input", (event) => {
  customerSearchTerm = event.currentTarget.value.trim().toLowerCase();
  customersPage = 1;
  if (latestUsersSnapshot) renderUsers(latestUsersSnapshot);
});
document.getElementById("customerPageSize").addEventListener("change", () => {
  customersPage = 1;
  if (latestUsersSnapshot) renderUsers(latestUsersSnapshot);
});
document.getElementById("customerPrevPage").addEventListener("click", () => {
  customersPage = Math.max(1, customersPage - 1);
  if (latestUsersSnapshot) renderUsers(latestUsersSnapshot);
});
document.getElementById("customerNextPage").addEventListener("click", () => {
  customersPage += 1;
  if (latestUsersSnapshot) renderUsers(latestUsersSnapshot);
});

let latestUsersSnapshot = null;

function openCustomerView(account) {
  document.getElementById("customerViewTitle").textContent = account.displayName || account.email || "Detail pelanggan";
  const content = document.getElementById("customerViewContent");
  content.replaceChildren();
  const fields = [
    ["Email", account.email || account.id],
    ["Domain", account.domainName || "Belum disetel"],
    ["Paket", account.plan === "premium" ? "Premium" : "Gratis"],
    ["Status website", account.hostingStatus || "Belum diatur"],
    ["Tanggal mendaftar", formatAdminDate(account.createdAt)],
    ["Tanggal bayar Premium", formatAdminDate(account.premiumPaidAt)],
    ["Tanggal habis Premium", formatAdminDate(account.premiumExpiresAt)],
    ["Masa berlaku website", formatAdminDate(account.websiteExpiresAt || account.premiumExpiresAt)],
    ["Firebase Project ID", account.tenantProjectId || "Belum dikonfigurasi"],
    ["Status Firebase", ({ active: "Aktif", maintenance: "Pemeliharaan", suspended: "Dinonaktifkan", not_configured: "Belum dikonfigurasi" })[account.tenantFirebaseStatus] || (account.hostingStatus === "ready" ? "Aktif" : "Belum dikonfigurasi")],
    ["Akses akun", account.active === true ? "Aktif" : "Dinonaktifkan"],
    ["Tampil di landing page", account.publicShowcase === true ? "Ya" : "Tidak"],
  ];
  if (typeof account.websiteImageBase64 === "string" && account.websiteImageBase64.startsWith("data:image/")) {
    const photo = document.createElement("img"); photo.className = "customer-view-photo"; photo.src = account.websiteImageBase64; photo.alt = `Foto ${account.websiteName || account.displayName || "website"}`; content.append(photo);
  }
  const grid = document.createElement("div"); grid.className = "customer-view-grid";
  for (const [label, value] of fields) {
    const item = document.createElement("div"); const title = document.createElement("span"); title.textContent = label;
    const detail = document.createElement("strong"); detail.textContent = value;
    item.append(title, detail); grid.append(item);
  }
  content.append(grid);
  content.append(createAdminWebsiteTimeline(account));
  if (isHttpUrl(account.websiteUrl || "")) {
    const link = document.createElement("a"); link.className = "button button-dark customer-view-visit"; link.href = account.websiteUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Kunjungi website"; content.append(link);
  }
  document.getElementById("customerViewModal").classList.remove("hidden");
}

function adminWebsiteTimelineSteps(account) {
  const saved = account.websiteTimeline || {};
  const firebase = account.tenantFirebaseStatus || (account.tenantFirebaseConfig || account.tenantProjectId || account.hostingStatus === "ready" ? "active" : "not_configured");
  return [
    { key: "hosting", title: "Persiapan hosting", state: saved.hosting || (account.hostingStatus === "ready" ? "complete" : ["preparing", "configuring"].includes(account.hostingStatus) ? "in_progress" : "pending") },
    { key: "database", title: "Persiapan database", state: saved.database || (firebase === "active" ? "complete" : account.hostingStatus === "ready" && (account.tenantProjectId || account.tenantFirebaseConfig || account.plan === "premium") ? "in_progress" : "pending") },
    { key: "domain", title: "Menghubungkan ke domain", state: saved.domain || (account.hostingStatus === "ready" && account.domainName && account.websiteUrl ? "complete" : firebase === "active" && account.domainName ? "in_progress" : "pending") },
  ];
}

function createAdminWebsiteTimeline(account) {
  const panel = document.createElement("section"); panel.className = "admin-website-timeline";
  const heading = document.createElement("div"); heading.className = "admin-website-timeline-heading";
  const title = document.createElement("h3"); title.textContent = "Timeline website";
  const note = document.createElement("p"); note.textContent = "Progres persiapan yang dikelola untuk pelanggan ini.";
  heading.append(title, note); panel.append(heading);
  const list = document.createElement("ol"); list.className = "website-timeline admin-timeline-list";
  const labels = { complete: "Selesai", in_progress: "Sedang diproses", pending: "Menunggu" };
  for (const step of adminWebsiteTimelineSteps(account)) {
    const item = document.createElement("li"); item.className = `website-timeline-step is-${step.state}`;
    const marker = document.createElement("span"); marker.className = "website-timeline-marker"; marker.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div"); copy.className = "website-timeline-copy";
    const name = document.createElement("strong"); name.textContent = step.title;
    const state = document.createElement("span"); state.className = "website-timeline-state"; state.textContent = labels[step.state] || labels.pending;
    copy.append(name); item.append(marker, copy, state); list.append(item);
  }
  panel.append(list); return panel;
}

function renderUsers(snapshot) {
  latestUsersSnapshot = snapshot;
  const rows = document.getElementById("userRows");
  const accounts = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => String(a.email || a.id).localeCompare(String(b.email || b.id)));
  const customers = accounts.filter((account) => account.role === "customer");
  dashboardCustomers = customers;
  renderDashboardCharts();
  const visibleCustomers = customers.filter((account) => !customerSearchTerm || [account.displayName, account.email, account.domainName, account.tenantProjectId].some((value) => String(value || "").toLowerCase().includes(customerSearchTerm)));
  const pageSize = Number(document.getElementById("customerPageSize").value) || 10;
  const totalPages = Math.max(1, Math.ceil(visibleCustomers.length / pageSize));
  customersPage = Math.min(customersPage, totalPages);
  const firstIndex = visibleCustomers.length ? (customersPage - 1) * pageSize : 0;
  const pagedCustomers = visibleCustomers.slice(firstIndex, firstIndex + pageSize);
  // Keep published cards in sync with account name, registration date, and logo.
  for (const account of customers) {
    if (account.publicShowcase !== true || account.hostingStatus !== "ready" || !isOnlineDomain(account.domainName)) continue;
    const publicRef = doc(db, "public_websites", account.domainName);
    void getDoc(publicRef).then(async (published) => {
      if (!published.exists()) return;
      const current = published.data();
      const updates = {};
      const sppgName = account.sppgName || account.websiteName || account.displayName || "SPPG";
      const registered = toAdminDate(account.createdAt)?.toISOString();
      if (current.sppgName !== sppgName) updates.sppgName = sppgName;
      if (current.websiteName !== (account.websiteName || "")) updates.websiteName = account.websiteName || "";
      if (registered && current.createdAt !== registered) updates.createdAt = registered;
      if (typeof account.websiteImageBase64 === "string" && account.websiteImageBase64.startsWith("data:image/")
        && current.imageBase64 !== account.websiteImageBase64) updates.imageBase64 = account.websiteImageBase64;
      if (Object.keys(updates).length) await updateDoc(publicRef, updates);
    }).catch((error) => {
      console.warn(`Foto publik ${account.domainName} belum tersinkron:`, error);
      const notice = document.getElementById("showcaseSyncNotice");
      notice.textContent = `Foto ${account.domainName} belum tersinkron ke landing page (${error.code || error.message}). Publikasikan firestore.rules terbaru di Firebase Console, lalu tekan Simpan.`;
      notice.classList.remove("hidden");
    });
  }
  const premium = customers.filter((account) => account.plan === "premium").length;
  const preparing = customers.filter((account) => ["preparing", "configuring"].includes(account.hostingStatus)).length;
  const ready = customers.filter((account) => account.hostingStatus === "ready").length;
  const publicCount = customers.filter((account) => account.publicShowcase === true && account.hostingStatus === "ready").length;
  document.getElementById("userCount").textContent = String(customers.length);
  document.getElementById("premiumCount").textContent = String(premium);
  document.getElementById("preparingCount").textContent = String(preparing);
  document.getElementById("readyCount").textContent = String(ready);
  document.getElementById("publicCount").textContent = `${publicCount} ditampilkan publik`;
  document.getElementById("customerResultCount").textContent = `${visibleCustomers.length} dari ${customers.length} pelanggan`;
  document.getElementById("customerPageSummary").textContent = visibleCustomers.length ? `Menampilkan ${firstIndex + 1}–${firstIndex + pagedCustomers.length} dari ${visibleCustomers.length}` : "Tidak ada hasil";
  document.getElementById("customerPageNumber").textContent = `${customersPage} / ${totalPages}`;
  document.getElementById("customerPrevPage").disabled = customersPage <= 1;
  document.getElementById("customerNextPage").disabled = customersPage >= totalPages;
  renderRecentAccounts(customers);
  rows.replaceChildren();
  if (!visibleCustomers.length) {
    const empty = document.createElement("div"); empty.className = "empty-row"; empty.textContent = customers.length ? "Tidak ada pelanggan yang cocok dengan pencarian." : "Belum ada pelanggan."; rows.append(empty); return;
  }
  for (const account of pagedCustomers) {
    const row = document.createElement("article"); row.className = "customer-card";
    const userCell = document.createElement("div"); userCell.className = "customer-card-head";
    const headPhoto = document.createElement("img"); headPhoto.className = "customer-list-photo"; headPhoto.alt = ""; headPhoto.hidden = true;
    if (typeof account.websiteImageBase64 === "string" && account.websiteImageBase64.startsWith("data:image/")) { headPhoto.src = account.websiteImageBase64; headPhoto.hidden = false; }
    const name = document.createElement("strong"); name.textContent = account.displayName || account.email || account.id;
    const email = document.createElement("span"); email.className = "table-subtext"; email.textContent = account.email || account.id;
    const identity = document.createElement("div"); identity.className = "customer-identity"; identity.append(name, email);
    const identitySummary = document.createElement("div"); identitySummary.className = "customer-summary-identity"; identitySummary.append(headPhoto, identity);
    const accountDomain = document.createElement("span"); accountDomain.className = "customer-domain-pill"; accountDomain.textContent = account.domainName || "Domain belum disetel";
    const domainSummary = document.createElement("div"); domainSummary.className = "customer-summary-domain"; domainSummary.append(accountDomain);
    const packagePill = document.createElement("span"); packagePill.className = `customer-package-pill ${account.plan === "premium" ? "is-premium" : ""}`; packagePill.textContent = account.plan === "premium" ? "Premium" : "Gratis";
    const packageSummary = document.createElement("div"); packageSummary.className = "customer-summary-package"; packageSummary.append(packagePill);
    const statusSummary = document.createElement("div"); statusSummary.className = `customer-summary-status ${account.hostingStatus === "ready" ? "is-ready" : account.hostingStatus === "configuring" || account.hostingStatus === "preparing" ? "is-processing" : "is-idle"}`; statusSummary.textContent = account.hostingStatus === "ready" ? "Siap" : account.hostingStatus === "configuring" ? "Dikonfigurasi" : account.hostingStatus === "preparing" ? "Disiapkan" : "Belum diproses";
    const datesSummary = document.createElement("div"); datesSummary.className = "customer-summary-dates";
    for (const [label, value] of [["Daftar", account.createdAt], ["Bayar Premium", account.premiumPaidAt], ["Habis Premium", account.premiumExpiresAt], ["Habis website", account.websiteExpiresAt || account.premiumExpiresAt]]) {
      const dateLine = document.createElement("span"); const dateLabel = document.createElement("b"); dateLabel.textContent = `${label}: `; dateLine.append(dateLabel, document.createTextNode(formatAdminDate(value))); datesSummary.append(dateLine);
    }
    const editButton = document.createElement("button"); editButton.type = "button"; editButton.className = "button button-config customer-edit-button"; editButton.textContent = "Edit";
    const viewButton = document.createElement("button"); viewButton.type = "button"; viewButton.className = "button button-config customer-view-button"; viewButton.textContent = "View"; viewButton.addEventListener("click", () => openCustomerView(account));
    const visitLink = document.createElement("a"); visitLink.className = "button button-config customer-visit-button"; visitLink.textContent = "Kunjungi website";
    if (isHttpUrl(account.websiteUrl || "")) { visitLink.href = account.websiteUrl; visitLink.target = "_blank"; visitLink.rel = "noopener noreferrer"; } else { visitLink.href = "#"; visitLink.setAttribute("aria-disabled", "true"); visitLink.addEventListener("click", (event) => event.preventDefault()); }
    const deleteButton = document.createElement("button"); deleteButton.type = "button"; deleteButton.className = "button customer-delete-button"; deleteButton.textContent = "Hapus";
    deleteButton.addEventListener("click", async () => {
      const customerName = account.displayName || account.email || account.id;
      if (!window.confirm(`Hapus akun ${customerName}? Data akun, domain, dan kartu website publik terkait akan dihapus.`)) return;
      deleteButton.disabled = true; deleteButton.innerHTML = '<span class="loading-indicator loading-indicator-small" aria-hidden="true"></span> Menghapus';
      try {
        const deletion = writeBatch(db);
        deletion.delete(doc(db, accountCollection, account.id));
        if (isOnlineDomain(account.domainName)) {
          deletion.delete(doc(db, "domains", account.domainName));
          deletion.delete(doc(db, "public_websites", account.domainName));
        }
        await deletion.commit();
      } catch (error) {
        deleteButton.disabled = false; deleteButton.textContent = "Hapus";
        showError(`Akun gagal dihapus: ${error.message}`);
      }
    });
    const rowActions = document.createElement("div"); rowActions.className = "customer-row-actions"; rowActions.append(viewButton, visitLink, editButton, deleteButton);
    userCell.append(identitySummary, domainSummary, packageSummary, statusSummary, datesSummary, rowActions);
    const siteCell = document.createElement("section"); siteCell.className = "customer-card-section website-section";
    const sppgNameInput = document.createElement("input"); sppgNameInput.className = "admin-input"; sppgNameInput.maxLength = 100; sppgNameInput.placeholder = "Nama SPPG"; sppgNameInput.value = account.sppgName || account.websiteName || account.displayName || ""; sppgNameInput.setAttribute("aria-label", `Nama SPPG ${account.email}`); siteCell.append(sppgNameInput);
    const websiteInput = document.createElement("input"); websiteInput.className = "admin-input"; websiteInput.placeholder = "https://website.online"; websiteInput.value = account.websiteUrl || (account.domainName ? `https://${account.domainName}` : ""); websiteInput.setAttribute("aria-label", `URL website ${account.email}`); siteCell.append(websiteInput);
    const imageInput = document.createElement("input"); imageInput.className = "admin-input image-upload"; imageInput.type = "file"; imageInput.accept = "image/jpeg,image/png,image/webp"; imageInput.setAttribute("aria-label", `Unggah foto website ${account.email}`); siteCell.append(imageInput);
    const imagePreview = document.createElement("img"); imagePreview.className = "admin-image-preview"; imagePreview.alt = `Pratinjau foto ${account.websiteName || account.displayName || "website"}`; imagePreview.hidden = true;
    let imageDataValue = account.websiteImageBase64 || "";
    let pendingImageCompression = null;
    if (imageDataValue) { imagePreview.src = imageDataValue; imagePreview.hidden = false; }
    imagePreview.addEventListener("error", () => { imagePreview.hidden = true; }, { once: true });
    siteCell.append(imagePreview);
    const imageHint = document.createElement("span"); imageHint.className = "showcase-hint"; imageHint.textContent = imageDataValue ? "Foto tersimpan · pilih file untuk mengganti" : "Foto dipotong persegi dari tengah dan dikompres otomatis."; siteCell.append(imageHint);
    if (!imageDataValue && isOnlineDomain(account.domainName)) {
      void getDoc(doc(db, "public_websites", account.domainName)).then((published) => {
        const publicImage = published.exists() ? published.data().imageBase64 : "";
        if (typeof publicImage === "string" && /^data:image\/(jpeg|png|webp);base64,/i.test(publicImage)) {
          imageDataValue = publicImage;
          imagePreview.src = publicImage;
          imagePreview.hidden = false;
          headPhoto.src = publicImage;
          headPhoto.hidden = false;
          imageHint.textContent = "Foto diambil dari situs publik · pilih file untuk mengganti";
        }
      }).catch((error) => console.warn(`Foto publik ${account.domainName} tidak dapat dibaca:`, error));
    }
    imageInput.addEventListener("change", async () => {
      const file = imageInput.files?.[0];
      if (!file) return;
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { imageInput.value = ""; imageHint.textContent = "Pilih foto JPG, PNG, atau WebP."; return; }
      imageHint.innerHTML = '<span class="loading-indicator loading-indicator-small" aria-hidden="true"></span> Mengompres foto';
      pendingImageCompression = compressImage(file);
      try {
        imageDataValue = await pendingImageCompression;
        imagePreview.src = imageDataValue;
        imagePreview.hidden = false;
        headPhoto.src = imageDataValue;
        headPhoto.hidden = false;
        imageHint.textContent = "Foto tengah siap disimpan. Tekan Simpan perubahan untuk memperbarui website dan landing page.";
      } catch (error) { imageInput.value = ""; imageHint.textContent = error.message; }
      finally { pendingImageCompression = null; }
    });
    const showcaseLabel = document.createElement("label"); showcaseLabel.className = "showcase-toggle";
    const showcase = document.createElement("input"); showcase.type = "checkbox"; showcase.checked = account.publicShowcase === true;
    const showcaseText = document.createElement("span"); showcaseText.textContent = "Tampilkan di landing page";
    showcaseLabel.append(showcase, showcaseText); siteCell.append(showcaseLabel);
    const showcaseHint = document.createElement("span"); showcaseHint.className = "showcase-hint"; siteCell.append(showcaseHint);
    const firebaseCell = document.createElement("section"); firebaseCell.className = "customer-card-section firebase-section";
    const project = document.createElement("strong"); project.textContent = account.tenantProjectId || "Belum diatur";
    const configStatus = document.createElement("span"); configStatus.className = "table-subtext"; configStatus.textContent = account.tenantFirebaseConfig ? "Konfigurasi tersimpan" : "Belum dikonfigurasi";
    const configButton = document.createElement("button"); configButton.type = "button"; configButton.className = "button button-config"; configButton.textContent = account.tenantFirebaseConfig ? "Edit konfigurasi" : "Konfigurasi Firebase"; configButton.addEventListener("click", () => openFirebaseConfigModal(account));
    const firebaseStatus = document.createElement("select"); firebaseStatus.className = "plan-select firebase-status-select"; firebaseStatus.setAttribute("aria-label", `Status Firebase ${account.email}`);
    const currentFirebaseStatus = account.tenantFirebaseStatus || (account.tenantFirebaseConfig || account.tenantProjectId || account.hostingStatus === "ready" ? "active" : "not_configured");
    for (const [value, label] of [["not_configured", "Belum dikonfigurasi"], ["active", "Aktif"], ["maintenance", "Pemeliharaan"], ["suspended", "Dinonaktifkan"]]) { const option = document.createElement("option"); option.value = value; option.textContent = label; option.selected = currentFirebaseStatus === value; firebaseStatus.append(option); }
    firebaseCell.append(project, configStatus, firebaseStatus, configButton);
    const planCell = document.createElement("section"); planCell.className = "customer-plan-controls";
    const plan = document.createElement("select"); plan.className = "plan-select";
    for (const [value, label] of [["free", "Gratis"], ["premium", "Premium"]]) { const option = document.createElement("option"); option.value = value; option.textContent = label; option.selected = (account.plan || "free") === value; plan.append(option); }
    const status = document.createElement("select"); status.className = "plan-select status-select";
    for (const [value, label] of [["not_purchased", "Belum Premium"], ["preparing", "Sedang disiapkan"], ["configuring", "Sedang dikonfigurasi"], ["ready", "Siap"]]) { const option = document.createElement("option"); option.value = value; option.textContent = label; option.selected = (account.hostingStatus || "not_purchased") === value; status.append(option); }
    const premiumPaidDate = document.createElement("input"); premiumPaidDate.className = "admin-input premium-date-input"; premiumPaidDate.type = "date"; premiumPaidDate.value = dateInputValue(account.premiumPaidAt); premiumPaidDate.setAttribute("aria-label", `Tanggal bayar Premium ${account.email}`);
    const premiumExpiryDate = document.createElement("input"); premiumExpiryDate.className = "admin-input premium-date-input"; premiumExpiryDate.type = "date"; premiumExpiryDate.value = dateInputValue(account.premiumExpiresAt); premiumExpiryDate.setAttribute("aria-label", `Tanggal habis Premium ${account.email}`);
    const websiteExpiryDate = document.createElement("input"); websiteExpiryDate.className = "admin-input premium-date-input"; websiteExpiryDate.type = "date"; websiteExpiryDate.value = dateInputValue(account.websiteExpiresAt || account.premiumExpiresAt); websiteExpiryDate.setAttribute("aria-label", `Masa berlaku website ${account.email}`);
    const accountAccess = document.createElement("select"); accountAccess.className = "plan-select account-access-select"; accountAccess.setAttribute("aria-label", `Status akses akun ${account.email}`);
    for (const [value, label] of [["active", "Akun aktif"], ["disabled", "Akun dinonaktifkan"]]) { const option = document.createElement("option"); option.value = value; option.textContent = label; option.selected = account.active === true ? value === "active" : value === "disabled"; accountAccess.append(option); }
    const paidLabel = document.createElement("label"); paidLabel.className = "customer-date-field"; paidLabel.append(document.createTextNode("Tanggal bayar Premium"), premiumPaidDate);
    const expiryLabel = document.createElement("label"); expiryLabel.className = "customer-date-field"; expiryLabel.append(document.createTextNode("Tanggal habis Premium"), premiumExpiryDate);
    const websiteExpiryLabel = document.createElement("label"); websiteExpiryLabel.className = "customer-date-field"; websiteExpiryLabel.append(document.createTextNode("Masa berlaku website"), websiteExpiryDate);
    planCell.append(plan, status, accountAccess, paidLabel, expiryLabel, websiteExpiryLabel);
    const timelineSection = document.createElement("section"); timelineSection.className = "website-timeline-editor";
    const timelineHeading = document.createElement("div"); timelineHeading.className = "admin-website-timeline-heading";
    const timelineTitle = document.createElement("h3"); timelineTitle.textContent = "Timeline penyiapan website";
    const timelineDescription = document.createElement("p"); timelineDescription.textContent = "Perbarui setiap tahap agar pelanggan melihat progres terbaru.";
    timelineHeading.append(timelineTitle, timelineDescription); timelineSection.append(timelineHeading);
    const savedTimeline = account.websiteTimeline || {};
    const timelineFirebase = account.tenantFirebaseStatus || (account.tenantFirebaseConfig || account.tenantProjectId || account.hostingStatus === "ready" ? "active" : "not_configured");
    const timelineDefaults = {
      hosting: account.hostingStatus === "ready" ? "complete" : ["preparing", "configuring"].includes(account.hostingStatus) ? "in_progress" : "pending",
      database: timelineFirebase === "active" ? "complete" : account.hostingStatus === "ready" && (account.tenantProjectId || account.tenantFirebaseConfig || account.plan === "premium") ? "in_progress" : "pending",
      domain: account.hostingStatus === "ready" && account.domainName && account.websiteUrl ? "complete" : timelineFirebase === "active" && account.domainName ? "in_progress" : "pending",
    };
    const timelineControls = {};
    for (const [key, label] of [["hosting", "Persiapan hosting"], ["database", "Persiapan database"], ["domain", "Menghubungkan ke domain"]]) {
      const field = document.createElement("label"); field.className = "website-timeline-editor-field"; field.textContent = label;
      const select = document.createElement("select"); select.className = "plan-select"; select.setAttribute("aria-label", `${label} untuk ${account.email}`);
      for (const [value, optionLabel] of [["pending", "Belum dimulai"], ["in_progress", "Sedang diproses"], ["complete", "Selesai"]]) { const option = document.createElement("option"); option.value = value; option.textContent = optionLabel; option.selected = (savedTimeline[key] || timelineDefaults[key]) === value; select.append(option); }
      timelineControls[key] = select; field.append(select); timelineSection.append(field);
    }
    plan.addEventListener("change", () => {
      if (plan.value === "premium" && account.plan !== "premium" && !premiumPaidDate.value) premiumPaidDate.value = new Date().toISOString().slice(0, 10);
    });
    const updateShowcaseAvailability = () => {
      const parsedWebsite = parseWebsiteInput(websiteInput.value);
      const websiteExpiry = websiteExpiryDate.value ? new Date(`${websiteExpiryDate.value}T23:59:59`) : null;
      const websiteValid = !websiteExpiry || websiteExpiry.getTime() > Date.now();
      const eligible = plan.value === "premium" && status.value === "ready" && firebaseStatus.value === "active" && websiteValid && Boolean(sppgNameInput.value.trim()) && isOnlineDomain(parsedWebsite.domainName) && isHttpUrl(parsedWebsite.websiteUrl);
      showcase.disabled = !eligible;
      if (!eligible) showcase.checked = false;
      showcaseHint.textContent = plan.value !== "premium" ? "Perlu paket Premium." : status.value !== "ready" ? "Set status website ke Siap." : firebaseStatus.value !== "active" ? "Aktifkan status Firebase sebelum publikasi." : !websiteValid ? "Masa berlaku website sudah lewat." : !sppgNameInput.value.trim() ? "Isi nama SPPG untuk publikasi." : !isHttpUrl(parsedWebsite.websiteUrl) ? "Masukkan URL lengkap, contoh https://website.online." : !isOnlineDomain(parsedWebsite.domainName) ? "URL harus memakai domain .online." : "Website siap dipublikasikan.";
    };
    plan.addEventListener("change", updateShowcaseAvailability);
    status.addEventListener("change", updateShowcaseAvailability);
    firebaseStatus.addEventListener("change", updateShowcaseAvailability);
    websiteExpiryDate.addEventListener("change", updateShowcaseAvailability);
    websiteInput.addEventListener("input", updateShowcaseAvailability);
    sppgNameInput.addEventListener("input", updateShowcaseAvailability);
    updateShowcaseAvailability();
    const actionCell = document.createElement("div"); actionCell.className = "customer-card-actions"; const save = document.createElement("button"); save.type = "button"; save.className = "button button-save"; save.textContent = "Simpan perubahan";
    save.onclick = async () => {
      save.disabled = true; save.innerHTML = '<span class="loading-indicator loading-indicator-small" aria-hidden="true"></span> Menyimpan';
      try {
        if (pendingImageCompression) imageDataValue = await pendingImageCompression;
        const now = new Date().toISOString();
        const parsedWebsite = parseWebsiteInput(websiteInput.value);
        const normalizedDomain = parsedWebsite.domainName;
        const websiteNameValue = parsedWebsite.websiteName;
        const websiteUrlValue = parsedWebsite.websiteUrl;
        const sppgNameValue = sppgNameInput.value.trim();
        if (normalizedDomain && !isOnlineDomain(normalizedDomain)) throw new Error("Domain website harus berakhiran .online.");
        const update = { active: accountAccess.value === "active", plan: plan.value, hostingStatus: plan.value === "premium" ? status.value : "not_purchased", tenantFirebaseStatus: firebaseStatus.value, websiteTimeline: { hosting: timelineControls.hosting.value, database: timelineControls.database.value, domain: timelineControls.domain.value }, websiteTimelineUpdatedAt: now, sppgName: sppgNameValue, websiteName: websiteNameValue, domainName: normalizedDomain, websiteUrl: websiteUrlValue, websiteImageBase64: imageDataValue, publicShowcase: showcase.checked, premiumPaidAt: plan.value === "premium" ? premiumPaidDate.value : "", premiumExpiresAt: plan.value === "premium" ? premiumExpiryDate.value : "", websiteExpiresAt: websiteExpiryDate.value, planUpdatedAt: now, hostingUpdatedAt: now };
        if (update.hostingStatus === "ready" && !isHttpUrl(update.websiteUrl)) throw new Error("Isi URL website lengkap, termasuk https://, sebelum menandai website siap.");
        if (showcase.checked && (!update.sppgName || !update.websiteName || !isOnlineDomain(update.domainName) || !isHttpUrl(update.websiteUrl))) throw new Error("Isi nama SPPG, nama website, domain .online, dan URL http/https yang valid untuk ditampilkan.");
        const domainRef = normalizedDomain ? doc(db, "domains", normalizedDomain) : null;
        let domainSnapshot = null;
        if (domainRef && normalizedDomain !== account.domainName) domainSnapshot = await getDoc(domainRef);
        if (domainSnapshot?.exists()) throw new Error("Domain tersebut sudah dipesan akun lain. Gunakan domain lain.");
        const batch = writeBatch(db);
        batch.update(doc(db, accountCollection, account.id), update);
        if (domainRef && normalizedDomain !== account.domainName && domainSnapshot && !domainSnapshot.exists()) {
          batch.set(domainRef, { domainName: normalizedDomain, createdAt: now });
        }
        const previousPublicRef = account.domainName && account.domainName !== normalizedDomain ? doc(db, "public_websites", account.domainName) : null;
        if (previousPublicRef) batch.delete(previousPublicRef);
        const publicRef = normalizedDomain ? doc(db, "public_websites", normalizedDomain) : null;
        if (showcase.checked && publicRef) {
          batch.set(publicRef, { sppgName: update.sppgName, websiteName: update.websiteName, domainName: normalizedDomain, websiteUrl: update.websiteUrl, imageBase64: imageDataValue, createdAt: toAdminDate(account.createdAt)?.toISOString() || now });
        } else if (publicRef) {
          batch.delete(publicRef);
        }
        await batch.commit();
        save.textContent = "Tersimpan";
        closeCustomerEditModal();
      } catch (error) { showError(`Perubahan gagal disimpan: ${error.message}`); save.textContent = "Simpan"; }
      finally { save.disabled = false; }
    };
    const sections = document.createElement("div"); sections.className = "customer-card-grid";
    const websiteTitle = document.createElement("h3"); websiteTitle.textContent = "Website"; websiteTitle.className = "customer-section-title"; siteCell.prepend(websiteTitle);
    const firebaseTitle = document.createElement("h3"); firebaseTitle.textContent = "Firebase"; firebaseTitle.className = "customer-section-title"; firebaseCell.prepend(firebaseTitle);
    const planTitle = document.createElement("h3"); planTitle.textContent = "Paket dan status"; planTitle.className = "customer-section-title"; planCell.prepend(planTitle);
    sections.append(siteCell, firebaseCell, planCell);
    actionCell.append(save);
    const editBody = document.createElement("div"); editBody.className = "customer-edit-body"; editBody.append(sections, timelineSection, actionCell);
    editButton.addEventListener("click", () => {
      document.getElementById("customerEditTitle").textContent = `Edit ${account.displayName || account.email || "pelanggan"}`;
      document.getElementById("customerEditSlot").replaceChildren(editBody);
      document.getElementById("customerEditModal").classList.remove("hidden");
    });
    row.append(userCell); rows.append(row);
  }
}

function renderRecentAccounts(customers) {
  const list = document.getElementById("recentAccounts");
  list.replaceChildren();
  const recent = [...customers].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 5);
  if (!recent.length) {
    const empty = document.createElement("div"); empty.className = "empty-row"; empty.textContent = "Belum ada pelanggan terdaftar."; list.append(empty); return;
  }
  for (const account of recent) {
    const row = document.createElement("div"); row.className = "recent-account-row";
    const initials = document.createElement("span"); initials.className = "recent-account-avatar";
    initials.textContent = String(account.websiteName || account.displayName || "S").trim().slice(0, 1).toUpperCase();
    const identity = document.createElement("div"); identity.className = "recent-account-identity";
    const name = document.createElement("strong"); name.textContent = account.websiteName || account.displayName || "SPPG baru";
    const domain = document.createElement("span"); domain.textContent = account.domainName || account.email || account.id;
    identity.append(name, domain);
    const state = document.createElement("span");
    const isReady = account.hostingStatus === "ready";
    state.className = `recent-account-status ${isReady ? "status-ready" : account.plan === "premium" ? "status-preparing" : "status-free"}`;
    state.textContent = isReady ? "Siap" : account.plan === "premium" ? "Diproses" : "Gratis";
    row.append(initials, identity, state); list.append(row);
  }
}

onAuthStateChanged(auth, async (user) => {
  unsubscribeUsers?.(); unsubscribeUsers = null; unsubscribePaymentRequests?.(); unsubscribePaymentRequests = null; unsubscribePaymentOrders?.(); unsubscribePaymentOrders = null; panel.classList.add("hidden"); errorBox.classList.add("hidden");
  signOutButton.classList.toggle("hidden", !user);
  if (!user) return showError("Login untuk mengelola pelanggan.", true);
  loading.classList.remove("hidden");
  try {
    const email = String(user.email || "").trim().toLowerCase();
    const accountSnapshot = await getDoc(doc(db, accountCollection, email));
    if (email !== controlAdminEmail || !accountSnapshot.exists() || accountSnapshot.data().active !== true || accountSnapshot.data().role !== "super_admin") return showError("Akses ditolak. Panel ini hanya untuk Super Admin yang ditetapkan.");
    try {
      const demoSettings = await getDoc(doc(db, "public_settings", "demo_package"));
      document.getElementById("demoPackageVisible").checked = !demoSettings.exists() || demoSettings.data().demoVisible !== false;
      document.getElementById("demoPackageSettingStatus").textContent = demoSettings.exists() ? "Pengaturan terakhir dimuat." : "Paket demo ditampilkan secara default.";
    } catch (error) {
      document.getElementById("demoPackageSettingStatus").textContent = `Pengaturan tidak dapat dimuat: ${error.message}`;
    }
    unsubscribeUsers = onSnapshot(collection(db, accountCollection), (snapshot) => { renderUsers(snapshot); loading.classList.add("hidden"); panel.classList.remove("hidden"); }, (error) => showError(`Data pelanggan tidak dapat dimuat: ${error.message}`));
    unsubscribePaymentRequests = onSnapshot(collection(db, "payment_requests"), renderPaymentRequests, (error) => {
      document.getElementById("paymentAdminSummary").textContent = `Pengajuan belum dapat dimuat: ${error.message}`;
      document.getElementById("paymentRequestList").textContent = `Periksa aturan Firestore payment_requests. ${error.message}`;
    });
    unsubscribePaymentOrders = onSnapshot(collection(db, "payment_orders"), renderCustomerPaymentOrders, (error) => {
      document.getElementById("customerPaymentOrders").textContent = `Pesanan QRIS belum dapat dimuat. Publikasikan aturan payment_orders terbaru. ${error.message}`;
    });
  } catch (error) { showError(`Role admin tidak dapat diverifikasi: ${error.message}`); }
});
