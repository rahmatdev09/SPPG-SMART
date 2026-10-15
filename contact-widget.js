import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { accountCollection, auth, db } from "./firebase.js";

(() => {
  // Set this to the admin's WhatsApp number in international format (digits only).
  const ADMIN_WHATSAPP_NUMBER = "6285709510427";
  const email = "rahmatdev09@gmail.com";
  let signedInUser = null;
  let releaseAuthReady;
  const authReady = new Promise((resolve) => { releaseAuthReady = resolve; });
  onAuthStateChanged(auth, (user) => {
    signedInUser = user;
    releaseAuthReady?.();
    releaseAuthReady = null;
  });
  const triggers = [...document.querySelectorAll(".contact-admin-fab")];
  if (!triggers.length) return;

  const widget = document.createElement("section");
  widget.className = "contact-widget hidden";
  widget.setAttribute("role", "dialog");
  widget.setAttribute("aria-label", "Bantuan SPPG Smart");
  widget.innerHTML = `
    <header class="contact-widget-header">
      <img class="contact-widget-avatar" src="./assets/sppg-smart-icon.svg" alt="" />
      <span class="contact-widget-heading"><strong>Bantuan SPPG Smart</strong><small>Asisten otomatis · balasan langsung</small></span>
      <button class="contact-widget-close" type="button" aria-label="Tutup bantuan">×</button>
    </header>
    <div class="contact-widget-tabs" role="tablist" aria-label="Cara menghubungi admin">
      <button class="contact-widget-tab is-active" type="button" role="tab" aria-selected="true" data-contact-tab="chat">Chat bantuan</button>
      <button class="contact-widget-tab" type="button" role="tab" aria-selected="false" data-contact-tab="admin">Hubungi admin</button>
    </div>
    <div class="contact-widget-chat" data-contact-panel="chat">
      <div class="contact-widget-messages" aria-live="polite" aria-relevant="additions text"></div>
      <div class="contact-widget-suggestions">
        <button type="button" data-suggestion="Cek status akun saya">Status akun</button>
        <button type="button" data-suggestion="Bagaimana status website saya?">Status website</button>
        <button type="button" data-suggestion="Bagaimana cara aktivasi Premium?">Paket Premium</button>
        <button type="button" data-suggestion="Bagaimana status pembayaran saya?">Pembayaran</button>
      </div>
      <form class="contact-widget-form">
        <label class="sr-only" for="contactWidgetInput">Tulis pesan</label>
        <input id="contactWidgetInput" maxlength="500" autocomplete="off" placeholder="Tulis pertanyaan Anda…" />
        <button type="submit" aria-label="Kirim pesan"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-5 16-3-6-8-2Z"/><path d="m12 14 4-5"/></svg></button>
      </form>
      <p class="contact-widget-note">Jawaban otomatis. Untuk bantuan admin, pilih tab Hubungi admin.</p>
    </div>
    <div class="contact-widget-admin hidden" data-contact-panel="admin">
      <p>Silakan pilih cara untuk menghubungi admin. Pesan Anda tidak akan dikirim sebelum Anda menekan tombol kirim di aplikasi tujuan.</p>
      <a class="contact-channel contact-channel-email" href="mailto:${email}?subject=Bantuan%20SPPG%20Smart"><span class="contact-channel-icon" aria-hidden="true">✉</span><span><strong>Email admin</strong><small>${email}</small></span><b aria-hidden="true">›</b></a>
      <a class="contact-channel contact-channel-whatsapp" href="#" target="_blank" rel="noopener noreferrer"><span class="contact-channel-icon" aria-hidden="true">◉</span><span><strong>WhatsApp admin</strong><small class="contact-whatsapp-caption">Buka percakapan WhatsApp</small></span><b aria-hidden="true">›</b></a>
      <p class="contact-widget-wa-hint hidden">Nomor WhatsApp admin belum diatur. Silakan hubungi admin melalui email.</p>
    </div>`;
  document.body.append(widget);

  const chatPanel = widget.querySelector('[data-contact-panel="chat"]');
  const adminPanel = widget.querySelector('[data-contact-panel="admin"]');
  const messages = widget.querySelector(".contact-widget-messages");
  const input = widget.querySelector("#contactWidgetInput");
  const whatsapp = widget.querySelector(".contact-channel-whatsapp");
  const waHint = widget.querySelector(".contact-widget-wa-hint");
  if (/^\d{8,15}$/.test(ADMIN_WHATSAPP_NUMBER)) {
    whatsapp.href = `https://wa.me/${ADMIN_WHATSAPP_NUMBER}?text=${encodeURIComponent("Halo Admin SPPG Smart, saya membutuhkan bantuan.")}`;
  } else {
    whatsapp.classList.add("is-unavailable");
    whatsapp.removeAttribute("target");
    whatsapp.setAttribute("aria-disabled", "true");
    whatsapp.addEventListener("click", (event) => event.preventDefault());
    waHint.classList.remove("hidden");
  }

  const addMessage = (text, sender) => {
    const bubble = document.createElement("p");
    bubble.className = `contact-message contact-message-${sender}`;
    bubble.textContent = text;
    messages.append(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  };
  const formatDate = (value) => {
    if (!value) return "belum tercatat";
    const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? "belum tercatat" : new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(date);
  };
  const loadOwnAccount = async () => {
    await authReady;
    if (!signedInUser?.email) return { user: null, account: null, error: "Anda belum login. Silakan masuk dengan Google terlebih dahulu agar saya dapat memeriksa data akun Anda." };
    const userEmail = signedInUser.email.trim().toLowerCase();
    try {
      const snapshot = await getDoc(doc(db, accountCollection, userEmail));
      if (!snapshot.exists()) return { user: signedInUser, account: null, error: "Data akun belum ditemukan. Pastikan Anda masuk dengan email yang terdaftar." };
      return { user: signedInUser, account: snapshot.data(), error: "" };
    } catch {
      return { user: signedInUser, account: null, error: "Data akun belum dapat dimuat. Periksa koneksi internet lalu coba lagi." };
    }
  };
  const answerFor = async (message) => {
    const text = message.toLowerCase();
    const asksPersonalAccount = /(akun|status|profil|data|email|nama|paket|premium|berakhir|masa aktif|langganan)/.test(text) && /(saya|ku|akun|cek|periksa|status|data|profil|kapan|apa|berapa|aktif)/.test(text);
    const asksPersonalPayment = /(pembayaran|pengajuan|qris|transfer|bayar|transaksi)/.test(text) && /(saya|ku|status|cek|terakhir|sudah|riwayat|kapan|berapa)/.test(text);
    const asksPersonalWebsite = /(website|domain|hosting|firebase|progres)/.test(text) && /(saya|ku|status|cek|siap|progres|domain|tahap|kapan)/.test(text);

    if (asksPersonalAccount || asksPersonalPayment || asksPersonalWebsite) {
      const { user, account, error } = await loadOwnAccount();
      if (error) return error;
      if (asksPersonalPayment) {
        try {
          const paymentQuery = query(collection(db, "payment_requests"), where("email", "==", user.email.trim().toLowerCase()));
          const paymentSnapshot = await getDocs(paymentQuery);
          if (paymentSnapshot.empty) return "Saya memeriksa pengajuan Anda: belum ada pengajuan pembayaran yang tercatat pada akun ini.";
          const latest = paymentSnapshot.docs.map((item) => item.data()).sort((a, b) => {
            const toMillis = (value) => value?.toMillis?.() || new Date(value || 0).getTime() || 0;
            return toMillis(b.createdAt) - toMillis(a.createdAt);
          })[0];
          const labels = { pending: "menunggu verifikasi admin", received: "sudah diterima dan terverifikasi", rejected: "ditolak" };
          const amount = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(latest.amount || 0);
          const date = formatDate(latest.createdAt);
          const note = latest.status === "rejected" ? " Periksa catatan admin di riwayat pembayaran atau hubungi admin bila perlu." : latest.status === "pending" ? " Setelah diverifikasi, status paket akan diperbarui." : " Paket Premium Anda telah terverifikasi.";
          return `Pengajuan pembayaran terakhir Anda sebesar ${amount} (${date}) ${labels[latest.status] || "sedang diproses"}.${note} Riwayat lengkap tersedia di menu Pembayaran.`;
        } catch {
          return "Saya belum dapat membaca riwayat pembayaran. Buka menu Pembayaran atau hubungi admin untuk bantuan.";
        }
      }
      const statusLabels = { preparing: "sedang disiapkan", configuring: "sedang dikonfigurasi", ready: "siap", not_purchased: "belum dimulai" };
      const planExpiry = account.premiumExpiresAt || account.websiteExpiresAt;
      const expiryDate = planExpiry ? (typeof planExpiry.toDate === "function" ? planExpiry.toDate() : new Date(planExpiry)) : null;
      const planValid = !expiryDate || expiryDate.getTime() > Date.now();
      const plan = account.plan === "premium" && planValid ? "Premium aktif" : account.plan === "premium" ? "Premium sudah berakhir" : "Gratis";
      const accountState = account.active === true ? "aktif" : "nonaktif";
      const websiteStatus = statusLabels[account.hostingStatus || (account.plan === "premium" ? "preparing" : "not_purchased")] || "sedang disiapkan";
      if (asksPersonalWebsite) {
        const timeline = account.websiteTimeline || {};
        const stages = [["hosting", "hosting"], ["database", "database"], ["domain", "domain"]];
        const stageLabels = { complete: "selesai", in_progress: "sedang diproses", pending: "menunggu" };
        const stageText = stages.map(([key, label]) => `${label} ${stageLabels[timeline[key]] || "menunggu"}`).join(", ");
        const available = account.websiteUrl && account.hostingStatus === "ready" ? ` Website: ${account.websiteUrl}.` : "";
        return `Status website akun Anda ${websiteStatus}${account.domainName ? `, domain ${account.domainName}` : ", domain belum dipilih"}${account.websiteName ? `, nama ${account.websiteName}` : ""}. Tahapan: ${stageText}.${available} Detail terbaru ada di menu Website.`;
      }
      const expiryDetail = expiryDate && !Number.isNaN(expiryDate.getTime()) ? ` Masa aktif tercatat sampai ${formatDate(expiryDate)}${planValid ? ` (tersisa ${Math.max(0, Math.ceil((expiryDate.getTime() - Date.now()) / 86400000))} hari)` : " (sudah berakhir)"}.` : " Masa aktif Premium belum tercatat.";
      const displayName = account.displayName || user.displayName || "Pengguna";
      return `Akun ${displayName} (${user.email}) berstatus ${accountState}, paket ${plan}, role ${account.role || "customer"}.${account.sppgName ? ` Nama SPPG: ${account.sppgName}.` : ""}${expiryDetail}`;
    }
    if (/pembayaran|qris|transfer|pengajuan|nominal/.test(text)) return "Pembayaran Premium dilakukan dengan QRIS dari menu Pembayaran. Unggah bukti dan nama yang tertera; pengajuan menunggu verifikasi admin. Anda juga bisa bertanya ‘cek pembayaran saya’ untuk memeriksa pengajuan terakhir.";
    if (/premium|paket|harga|langganan|aktivasi/.test(text)) return "Paket Premium tersedia bulanan Rp150.000 dan tahunan Rp1.100.000. Buka menu Pembayaran, pilih masa aktif, pindai QRIS, lalu unggah bukti. Paket aktif setelah pembayaran diverifikasi.";
    if (/website|domain|hosting|firebase|siap|progres/.test(text)) return "Tahap website meliputi persiapan hosting, database, lalu koneksi domain. Status tiap tahap dapat dilihat di menu Website. Coba tulis ‘cek website saya’ untuk melihat data akun yang sedang login.";
    if (/login|masuk|google|daftar|registrasi/.test(text)) return "Pilih Masuk dengan Google dan gunakan email yang terdaftar. Akun baru dapat didaftarkan dari landing page dengan melengkapi nama SPPG, nama website, dan domain yang tersedia.";
    if (/lupa|password|kata sandi/.test(text)) return "Masuk menggunakan Google, jadi kata sandi dikelola oleh akun Google Anda. Jika tidak dapat mengakses akun Google, gunakan proses pemulihan akun Google.";
    if (/domain|nama domain/.test(text)) return "Nama domain .online dapat dipilih saat mendaftar. Sistem memeriksa ketersediaannya sebelum pendaftaran. Domain dan progres penyambungannya dapat dilihat di menu Website.";
    if (/hosting|database|firebase/.test(text)) return "Proses website memiliki tiga tahap: persiapan hosting, persiapan database, dan menghubungkan domain. Progresnya diperbarui admin pada timeline menu Website.";
    if (/admin|manusia|kontak|hubungi|bantuan/.test(text)) return "Pilih tab Hubungi admin untuk mengirim email atau membuka WhatsApp. Pesan hanya terkirim setelah Anda mengirimkannya dari aplikasi tersebut.";
    if (/halo|hai|assalam|pagi|siang|sore|malam/.test(text)) return "Halo! Saya asisten otomatis SPPG Smart. Saya bisa mengecek status akun, website, dan pengajuan pembayaran Anda, serta menjawab pertanyaan tentang paket, login, dan domain.";
    return "Saya bisa membantu mengecek akun, status website, dan pembayaran Anda. Coba tanyakan ‘cek status akun saya’, ‘cek website saya’, atau ‘cek pembayaran saya’. Saya juga dapat menjawab FAQ tentang Premium, QRIS, login, domain, dan hosting.";
  };
  const submitMessage = (text) => {
    const clean = text.trim();
    if (!clean) return;
    addMessage(clean, "user");
    input.value = "";
    const typing = addMessage("Memeriksa…", "bot contact-message-typing");
    window.setTimeout(async () => {
      typing.remove();
      addMessage(await answerFor(clean), "bot");
    }, 550);
  };

  addMessage("Halo! Saya asisten bantuan otomatis SPPG Smart. Tanyakan tentang akun, pembayaran, paket Premium, atau website.", "bot");
  widget.querySelectorAll("[data-contact-tab]").forEach((tab) => tab.addEventListener("click", () => {
    const showChat = tab.dataset.contactTab === "chat";
    widget.querySelectorAll("[data-contact-tab]").forEach((item) => {
      const active = item === tab;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", String(active));
    });
    chatPanel.classList.toggle("hidden", !showChat);
    adminPanel.classList.toggle("hidden", showChat);
    if (showChat) input.focus();
  }));
  widget.querySelector(".contact-widget-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitMessage(input.value);
  });
  widget.querySelectorAll("[data-suggestion]").forEach((button) => button.addEventListener("click", () => submitMessage(button.dataset.suggestion)));
  const close = () => {
    widget.classList.add("hidden");
    triggers.forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
  };
  widget.querySelector(".contact-widget-close").addEventListener("click", close);
  triggers.forEach((trigger) => {
    trigger.href = "#contact-support";
    trigger.setAttribute("role", "button");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      const open = widget.classList.toggle("hidden") === false;
      trigger.setAttribute("aria-expanded", String(open));
      if (open) input.focus();
    });
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
})();
