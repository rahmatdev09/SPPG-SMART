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
const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

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
  if (description) description.textContent = daysLeft < 0 ? "Kirim bukti transfer untuk mengaktifkan kembali layanan Premium." : `Masa aktif tersisa ${daysLeft} hari, sampai ${expiryLabel}.`;
  const checkoutPanel = document.getElementById("checkoutPanel");
  checkoutPanel?.classList.toggle("hidden", daysLeft > 7);
  const checkoutTitle = document.getElementById("checkoutTitle");
  const checkoutButton = document.getElementById("checkoutButton");
  const secureNote = document.querySelector("#checkoutPanel .checkout-secure-note");
  if (checkoutTitle && daysLeft <= 7) checkoutTitle.textContent = daysLeft < 0 ? "Aktifkan kembali Premium" : "Perpanjang paket Premium";
  if (checkoutButton && daysLeft <= 7) checkoutButton.innerHTML = 'Kirim bukti perpanjangan <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
  if (secureNote && daysLeft <= 7) secureNote.textContent = "Perpanjangan diproses setelah admin memverifikasi bukti transfer.";
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

const paymentSuccessModal = document.getElementById("paymentSuccessModal");
function closePaymentSuccessModal() {
  paymentSuccessModal?.classList.add("hidden");
  document.getElementById("refreshPayments")?.focus();
}
function showPaymentSuccessModal() {
  if (!paymentSuccessModal) return;
  paymentSuccessModal.classList.remove("hidden");
  document.getElementById("closePaymentSuccess")?.focus();
}
document.getElementById("closePaymentSuccess")?.addEventListener("click", closePaymentSuccessModal);
document.getElementById("paymentSuccessDone")?.addEventListener("click", closePaymentSuccessModal);
paymentSuccessModal?.addEventListener("click", (event) => {
  if (event.target === paymentSuccessModal) closePaymentSuccessModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && paymentSuccessModal && !paymentSuccessModal.classList.contains("hidden")) closePaymentSuccessModal();
});

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

async function requestCheckout() {
  const button = document.getElementById("checkoutButton");
  const message = document.getElementById("checkoutMessage");
  button.disabled = true; button.innerHTML = '<span class="loading-indicator loading-indicator-light" aria-hidden="true"></span> Mengirim bukti'; message.textContent = "Mengunggah bukti transfer untuk ditinjau admin.";
  try {
    const user = auth.currentUser;
    if (!user?.email) throw new Error("Silakan login kembali.");
    const note = document.getElementById("paymentApplicantNote").value.trim();
    const file = document.getElementById("paymentProofInput").files?.[0];
    if (!note || !file) throw new Error("Isi nama pengirim dan pilih bukti transfer terlebih dahulu.");
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) throw new Error("Pilih gambar JPG, PNG, atau WebP berukuran maksimal 8 MB.");
    const proofDataUrl = await compressProof(file);
    if (proofDataUrl.length > 680000) throw new Error("Bukti gambar masih terlalu besar. Pilih gambar yang lebih kecil.");
    await addDoc(collection(db, "payment_requests"), {
      email: user.email.toLowerCase(), displayName: user.displayName || "", amount: 150000,
      plan: "premium", paymentMethod: "manual_bsi_transfer", status: "pending", note, proofDataUrl,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    message.textContent = "Bukti pembayaran terkirim. Status menunggu pemeriksaan admin.";
    document.getElementById("paymentApplicantNote").value = "";
    document.getElementById("paymentProofInput").value = "";
    document.getElementById("paymentProofFileName").textContent = "Pilih gambar";
    document.getElementById("paymentProofPreview").classList.add("hidden");
    showPaymentSuccessModal();
  } catch (error) {
    console.error("Gagal mengirim bukti pembayaran:", error);
    message.textContent = error.message || "Bukti belum berhasil dikirim. Periksa koneksi dan coba lagi.";
  } finally {
    button.disabled = hasPendingPaymentRequest;
    const isRenewal = /perpanjang|aktifkan kembali/i.test(document.getElementById("checkoutTitle")?.textContent || "");
    button.innerHTML = isRenewal
      ? 'Kirim bukti perpanjangan <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>'
      : 'Kirim bukti pembayaran <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
  }
}

function compressProof(file) {
  return new Promise((resolve, reject) => {
    const image = new Image(); const source = URL.createObjectURL(file);
    image.onload = () => {
      const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(source); resolve(canvas.toDataURL("image/jpeg", .72));
    };
    image.onerror = () => { URL.revokeObjectURL(source); reject(new Error("Gambar bukti tidak dapat dibaca.")); };
    image.src = source;
  });
}

document.getElementById("copyBankAccount")?.addEventListener("click", async (event) => {
  try { await navigator.clipboard.writeText("7377781222"); event.currentTarget.textContent = "Nomor rekening tersalin"; }
  catch { document.getElementById("checkoutMessage").textContent = "Nomor rekening: 7377781222 · BSI"; }
});
document.getElementById("paymentProofInput")?.addEventListener("change", (event) => {
  const file = event.currentTarget.files?.[0];
  document.getElementById("paymentProofFileName").textContent = file ? `${file.name} · siap diunggah` : "Pilih gambar";
});

document.getElementById("checkoutButton").addEventListener("click", requestCheckout);
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
  } catch (error) { document.getElementById("checkoutMessage").textContent = "Status belum dapat diperiksa. Coba lagi sebentar."; console.error(error); }
  finally { button.disabled = false; button.innerHTML = '<svg class="refresh-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4.8 9A7.5 7.5 0 0 1 18 6.5L20 12M4 17v-5h5m10.2 3A7.5 7.5 0 0 1 6 17.5L4 12"/></svg><span>Perbarui status</span>'; }
});

onAuthStateChanged(auth, async (user) => {
  const loadVersion = ++accountLoadVersion;
  unsubscribePaymentRequests?.();
  unsubscribePaymentRequests = null;
  refreshPaymentStatus = null;
  card.classList.add("hidden");
  errorBox.classList.add("hidden");
  signOutButton.classList.toggle("hidden", !user);
  if (!user) {
    showError("Anda belum login.");
    return;
  }

  loading.classList.remove("hidden");
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
    document.getElementById("websitePremiumExpiresAt").textContent = formatAccountDateTime(account.websiteExpiresAt || account.premiumExpiresAt);
    renderPremiumExpiry(account);
    document.getElementById("dashboardPlan").textContent = isPremium ? "Premium" : premiumExpired ? "Premium berakhir" : "Paket Gratis";
    document.getElementById("dashboardDomain").textContent = account.domainName || "Belum dipilih";
    document.getElementById("planPill").textContent = isPremium ? "Premium" : premiumExpired ? "Premium berakhir" : "Paket Gratis";
    document.getElementById("planPill").classList.toggle("premium-pill", isPremium || premiumExpired);

    const summary = document.getElementById("planSummary");
    summary.classList.toggle("premium-summary", isPremium);
    summary.textContent = premiumExpired
      ? "Masa aktif Premium Anda sudah berakhir. Kirim bukti transfer perpanjangan untuk mengaktifkan layanan kembali."
      : isPremium
      ? "Paket Premium aktif — modul aplikasi tersedia sesuai role akun Anda."
      : "Paket Gratis aktif — akun Anda dapat melihat profil. Fitur pengelolaan lengkap tersedia pada Premium (Rp150.000/bulan).";
    document.getElementById("premiumActions").classList.toggle("hidden", !isPremium);
    unsubscribePaymentRequests = onSnapshot(query(collection(db, "payment_requests"), where("email", "==", email)), (snapshot) => {
      const history = document.getElementById("paymentHistory");
      const list = document.getElementById("paymentList");
      if (!history || !list) return;
      hasPendingPaymentRequest = snapshot.docs.some((payment) => payment.data().status === "pending");
      const checkoutButton = document.getElementById("checkoutButton");
      checkoutButton.disabled = hasPendingPaymentRequest;
      const checkoutMessage = document.getElementById("checkoutMessage");
      if (hasPendingPaymentRequest) checkoutMessage.textContent = "Pengajuan Anda sedang diperiksa admin. Tunggu hasil verifikasi sebelum mengirim bukti baru.";
      else if (checkoutMessage.textContent.startsWith("Pengajuan Anda sedang diperiksa")) checkoutMessage.textContent = "";
      history.classList.remove("hidden");
      list.replaceChildren();
      if (snapshot.empty) {
        const empty = document.createElement("p"); empty.className = "payment-empty"; empty.textContent = "Belum ada pengajuan pembayaran. Instruksi transfer dan formulir pengajuan tersedia di atas."; list.append(empty); return;
      }
      for (const item of [...snapshot.docs].sort((a, b) => {
        const aTime = a.data().createdAt?.toMillis?.() || 0;
        const bTime = b.data().createdAt?.toMillis?.() || 0;
        return bTime - aTime;
      })) {
        const request = item.data();
        const row = document.createElement("article"); row.className = "payment-row";
        const details = document.createElement("div"); details.className = "payment-row-details";
        const title = document.createElement("strong"); title.textContent = `Transfer Premium · ${rupiah.format(request.amount || 150000)}`;
        const id = document.createElement("span"); id.textContent = `ID pengajuan: ${item.id}`;
        const note = document.createElement("span"); note.textContent = request.note || "Tanpa catatan";
        const date = document.createElement("span"); date.className = "payment-row-date"; date.textContent = formatAccountDateTime(request.createdAt);
        details.append(title, id, note, date);
        const status = document.createElement("span"); status.className = `payment-status payment-status-${request.status}`;
        status.textContent = ({ pending: "Menunggu verifikasi", received: "Terverifikasi", rejected: "Ditolak" })[request.status] || "Diproses";
        row.append(details, status); list.append(row);
      }
    }, (error) => console.warn("Riwayat transfer tidak dapat dimuat:", error));
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
    if (isPremium && firebaseStatus !== "active") summary.textContent = `Layanan Firebase berstatus ${firebaseStatusLabel(firebaseStatus).toLowerCase()}. Hubungi administrator untuk informasi lebih lanjut.`;
    else if (isPremium && websiteExpired) summary.textContent = "Masa berlaku website sudah berakhir. Hubungi administrator untuk memperpanjang layanan.";
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
