import { signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { collection, doc, getDoc, onSnapshot, runTransaction, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { accountCollection, auth, controlAdminEmail, db, googleProvider } from "./firebase.js";

const toast = document.getElementById("toast");
const loginButtons = ["googleLogin", "heroLogin", "priceLogin", "closingLogin"]
  .map((id) => document.getElementById(id)).filter(Boolean);
const signupForm = document.getElementById("signupForm");
const sppgNameInput = document.getElementById("sppgNameInput");
const websiteNameInput = document.getElementById("websiteNameInput");
const domainNameInput = document.getElementById("domainNameInput");
const domainMessage = document.getElementById("domainCheckMessage");
const domainStatusIcon = document.getElementById("domainStatusIcon");
const domainStatusTitle = document.getElementById("domainStatusTitle");
const domainStatusDetail = document.getElementById("domainStatusDetail");
const checkDomainButton = document.getElementById("checkDomain");
const signupButton = document.getElementById("signupGoogle");
const customerSites = document.getElementById("customerSites");
let checkedDomain = "";
let domainIsAvailable = false;

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.setTimeout(() => toast.classList.add("hidden"), 5000);
}

function renderCustomerSites(snapshot) {
  customerSites.replaceChildren();
  if (snapshot.empty) {
    const empty = document.createElement("div");
    empty.className = "customer-sites-empty";
    empty.textContent = "Belum ada website SPPG yang dipublikasikan. Website pelanggan akan tampil di sini setelah siap.";
    customerSites.append(empty);
    return;
  }
  snapshot.docs.forEach((siteDoc) => {
    const site = siteDoc.data();
    const card = document.createElement("article");
    card.className = "customer-site-card";
    const logoWrap = document.createElement("div");
    logoWrap.className = "customer-site-logo-wrap";
    if (typeof site.imageBase64 === "string" && /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/]+=*$/i.test(site.imageBase64)) {
      const image = document.createElement("img");
      image.className = "customer-site-image";
      image.src = site.imageBase64;
      image.alt = `Logo ${site.sppgName || site.websiteName || "SPPG"}`;
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => {
        image.remove();
        logoWrap.classList.add("has-fallback");
        logoWrap.textContent = "SPPG";
      }, { once: true });
      logoWrap.append(image);
    } else {
      logoWrap.classList.add("has-fallback");
      logoWrap.textContent = "SPPG";
    }
    card.append(logoWrap);
    const content = document.createElement("div");
    content.className = "customer-site-content";
    const kicker = document.createElement("span");
    kicker.className = "feature-kicker";
    kicker.textContent = "WEBSITE SPPG";
    const domain = document.createElement("span");
    domain.className = "customer-site-domain";
    domain.textContent = site.domainName || "";
    const sppgName = document.createElement("h3");
    sppgName.className = "customer-site-sppg-name";
    sppgName.textContent = site.sppgName || site.websiteName || "SPPG";
    content.append(kicker, sppgName);
    content.append(domain);
    const createdDate = site.createdAt?.toDate ? site.createdAt.toDate() : new Date(site.createdAt || "");
    if (!Number.isNaN(createdDate.getTime())) {
      const registered = document.createElement("span");
      registered.className = "customer-site-registered";
      registered.textContent = `Terdaftar ${new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(createdDate)}`;
      content.append(registered);
    }
    try {
      const url = new URL(site.websiteUrl);
      if (["https:", "http:"].includes(url.protocol)) {
        const link = document.createElement("a");
        link.className = "customer-site-link";
        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Kunjungi website ↗";
        const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        arrow.setAttribute("viewBox", "0 0 20 20");
        arrow.setAttribute("aria-hidden", "true");
        arrow.innerHTML = '<path d="M7 4h9v9M16 4 8 12M13 11v5H4V7h5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6"/>';
        link.textContent = "Kunjungi website";
        link.append(arrow);
        content.append(link);
      }
    } catch {
      // A broken public link is omitted while the rest of the listing remains visible.
    }
    card.append(content);
    customerSites.append(card);
  });
}

onSnapshot(collection(db, "public_websites"), renderCustomerSites, (error) => {
  const message = document.createElement("div");
  message.className = "customer-sites-empty";
  message.textContent = `Daftar website belum dapat dimuat: ${error.message}`;
  customerSites.replaceChildren(message);
});

function normalizeDomain() {
  return domainNameInput.value.trim().toLowerCase().replace(/\s+/g, "-");
}

function validDomainLabel(value) {
  return value.length >= 3 && value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

function setDomainStatus(state, title, detail) {
  const icons = { idle: "?", checking: "…", available: "✓", unavailable: "×", error: "!" };
  domainMessage.className = `domain-result domain-result-${state}`;
  domainStatusIcon.textContent = icons[state] || "!";
  domainStatusTitle.textContent = title;
  domainStatusDetail.textContent = detail;
}

function resetDomainCheck() {
  checkedDomain = "";
  domainIsAvailable = false;
  signupButton.disabled = true;
  setDomainStatus("idle", "BELUM DICEK", "Masukkan nama domain, lalu tekan “Cek nama”.");
}

async function checkDomain() {
  const label = normalizeDomain();
  domainNameInput.value = label;
  resetDomainCheck();
  if (!validDomainLabel(label)) {
    setDomainStatus("error", "FORMAT BELUM SESUAI", "Gunakan 3–63 karakter: huruf kecil, angka, atau tanda hubung di tengah.");
    return false;
  }
  checkDomainButton.disabled = true;
  checkDomainButton.innerHTML = '<span class="loading-indicator loading-indicator-small" aria-hidden="true"></span> Mengecek';
  setDomainStatus("checking", "SEDANG DICEK", `Memeriksa ${label}.online ke registry domain.`);
  try {
    const fullDomain = `${label}.online`;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    let registryResponse;
    try {
      registryResponse = await fetch(
        `https://rdap.radix.host/rdap/domain/${encodeURIComponent(fullDomain)}`,
        { headers: { Accept: "application/rdap+json, application/json" }, signal: controller.signal },
      );
    } finally {
      window.clearTimeout(timeoutId);
    }
    if (registryResponse.status === 200) {
      setDomainStatus("unavailable", "TIDAK TERSEDIA", `${fullDomain} sudah terdaftar di registry .online.`);
      return false;
    }
    if (registryResponse.status !== 404) {
      throw new Error(`Registry .online tidak dapat memastikan ketersediaan (HTTP ${registryResponse.status}).`);
    }
    const reservation = await getDoc(doc(db, "domains", fullDomain));
    if (reservation.exists()) {
      setDomainStatus("unavailable", "SUDAH DIPAKAI", `${fullDomain} sudah dipesan oleh pelanggan SPPG Smart.`);
      return false;
    }
    checkedDomain = fullDomain;
    domainIsAvailable = true;
    setDomainStatus("available", "TERSEDIA UNTUK DIDAFTARKAN", `${fullDomain} belum terdaftar dan belum dipakai di layanan kami. Domain tetap perlu dibeli melalui registrar.`);
    signupButton.disabled = !(sppgNameInput.value.trim() && websiteNameInput.value.trim());
    return true;
  } catch (error) {
    setDomainStatus("error", "BELUM BISA DIPASTIKAN", error.name === "AbortError"
      ? "Pengecekan registry .online melewati batas waktu. Tekan Cek nama untuk mencoba lagi."
      : `Registry tidak dapat dihubungi: ${error.message}`);
    return false;
  } finally {
    checkDomainButton.disabled = false;
    checkDomainButton.textContent = "Cek nama";
  }
}

async function accountFor(user) {
  const email = String(user.email || "").trim().toLowerCase();
  if (!email) throw new Error("Akun Google tidak memiliki email.");
  const snapshot = await getDoc(doc(db, accountCollection, email));
  return snapshot.exists() ? snapshot.data() : null;
}

async function login() {
  loginButtons.forEach((button) => { button.disabled = true; });
  try {
    const user = auth.currentUser || (await signInWithPopup(auth, googleProvider)).user;
    let account = await accountFor(user);
    const signedInEmail = String(user.email || "").trim().toLowerCase();
    if (!account && signedInEmail === controlAdminEmail) {
      const now = new Date().toISOString();
      account = {
        email: signedInEmail,
        displayName: user.displayName || "Super Admin",
        role: "super_admin",
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      await setDoc(doc(db, accountCollection, signedInEmail), account);
    }
    if (!account) {
      showToast("Akun belum terdaftar. Isi nama website dan cek domain .online terlebih dahulu.");
      document.getElementById("daftar").scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (account.active !== true) throw new Error("Akun Anda sedang dinonaktifkan. Hubungi administrator.");
    window.location.assign("./console.html");
  } catch (error) {
    showToast(`Login gagal: ${error.message}`);
  } finally {
    loginButtons.forEach((button) => { button.disabled = false; });
  }
}

checkDomainButton.addEventListener("click", checkDomain);
domainNameInput.addEventListener("input", resetDomainCheck);
websiteNameInput.addEventListener("input", () => {
  signupButton.disabled = !(domainIsAvailable && sppgNameInput.value.trim() && websiteNameInput.value.trim());
});
sppgNameInput.addEventListener("input", () => {
  signupButton.disabled = !(domainIsAvailable && sppgNameInput.value.trim() && websiteNameInput.value.trim());
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const sppgName = sppgNameInput.value.trim();
  const websiteName = websiteNameInput.value.trim();
  const label = normalizeDomain();
  if (!sppgName) return showToast("Isi nama SPPG terlebih dahulu.");
  if (!websiteName) return showToast("Isi nama website terlebih dahulu.");
  if (!validDomainLabel(label)) return showToast("Nama domain belum valid.");
  const domain = `${label}.online`;
  const available = await checkDomain();
  if (!available || checkedDomain !== domain) return;

  signupButton.disabled = true;
  signupButton.innerHTML = '<span class="loading-indicator loading-indicator-small loading-indicator-light" aria-hidden="true"></span> Membuat akun';
  try {
    const user = auth.currentUser || (await signInWithPopup(auth, googleProvider)).user;
    const email = String(user.email || "").trim().toLowerCase();
    if (!email) throw new Error("Akun Google tidak memiliki email.");
    const accountRef = doc(db, accountCollection, email);
    const domainRef = doc(db, "domains", domain);
    await runTransaction(db, async (transaction) => {
      const [accountSnapshot, domainSnapshot] = await Promise.all([
        transaction.get(accountRef), transaction.get(domainRef),
      ]);
      if (accountSnapshot.exists()) throw new Error("Akun Google ini sudah terdaftar. Silakan login.");
      if (domainSnapshot.exists()) throw new Error("Nama domain baru saja dipakai orang lain. Coba nama lain.");
      const now = new Date().toISOString();
      transaction.set(accountRef, {
        email,
        displayName: user.displayName || "Pengguna",
        role: "customer",
        active: true,
        plan: "free",
        hostingStatus: "not_purchased",
        sppgName,
        websiteName,
        domainName: domain,
        createdAt: now,
        updatedAt: now,
      });
      transaction.set(domainRef, { domainName: domain, createdAt: now });
    });
    window.location.assign("./console.html");
  } catch (error) {
    showToast(`Pendaftaran gagal: ${error.message}`);
  } finally {
    signupButton.textContent = "Daftar dengan Google";
    signupButton.disabled = !(domainIsAvailable && sppgNameInput.value.trim() && websiteNameInput.value.trim());
  }
});

loginButtons.forEach((button) => button.addEventListener("click", login));

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  try {
    const account = await accountFor(user);
    if (!account || account.active !== true) return;
    document.getElementById("accountLink")?.classList.remove("hidden");
    document.getElementById("signupLink")?.classList.add("hidden");
    document.getElementById("googleLogin")?.classList.add("hidden");
    for (const id of ["heroLogin", "priceLogin", "closingLogin"]) {
      const button = document.getElementById(id);
      if (button) {
        button.textContent = "Buka Akun ↗";
        button.addEventListener("click", () => window.location.assign("./console.html"));
      }
    }
  } catch (error) {
    showToast(`Akun tidak dapat dimuat: ${error.message}`);
  }
});
