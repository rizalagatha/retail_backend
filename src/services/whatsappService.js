const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const fs = require("fs");
const path = require("path");

// Objek untuk menyimpan semua instance klien WA, dengan key berupa kode cabang
const clients = {};
// Objek untuk menyimpan QR code yang sedang aktif
const qrCodes = {};
const clientStatus = {};

const sanitizeClientId = (cabang) => {
  // ganti karakter non-alfanumerik jadi underscore
  return cabang.replace(/[^a-zA-Z0-9_-]/g, "_");
};

// --- Inisialisasi Client ---
const createClient = (cabang) => {
  const clientId = sanitizeClientId(cabang);
  console.log(`[WhatsApp] Membuat client baru untuk cabang: ${clientId}`);
  clientStatus[cabang] = "INITIALIZING";

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: cabang }), // <-- Kunci: Session disimpan per cabang
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    },
  });

  client.on("qr", async (qr) => {
    console.log(`[WhatsApp] QR Code diterima untuk ${cabang}`);
    // Ubah QR menjadi data URL agar bisa dikirim via API
    qrCodes[cabang] = await qrcode.toDataURL(qr);
    clientStatus[cabang] = "QR_RECEIVED";
  });

  client.on("ready", () => {
    console.log(`[WhatsApp] Client untuk ${cabang} sudah siap!`);
    delete qrCodes[cabang]; // Hapus QR setelah siap
    clientStatus[cabang] = "READY";
  });

  client.on("auth_failure", (msg) => {
    console.error(`[WhatsApp] Gagal otentikasi untuk ${cabang}:`, msg);
    clientStatus[cabang] = "AUTH_FAILURE";
    delete clients[cabang];
  });

  client.on("disconnected", (reason) => {
    console.warn(`[WhatsApp] Disconnected untuk ${cabang}:`, reason);
    clientStatus[cabang] = "DISCONNECTED"; // <-- Update status
    // Hapus instance agar saat getClient dipanggil lagi, ia membuat ulang
    delete clients[cabang];
    delete qrCodes[cabang];
  });

  client.initialize().catch((err) => {
    console.error(`[WhatsApp] Gagal initialize client ${cabang}:`, err);
    clientStatus[cabang] = "ERROR_INIT";
    delete clients[cabang];
  });
  clients[cabang] = client;
  return client;
};

const getClient = (cabang) => {
  // Jika belum ada atau statusnya disconnected/error, buat baru
  if (
    !clients[cabang] ||
    ["DISCONNECTED", "AUTH_FAILURE", "ERROR_INIT"].includes(
      clientStatus[cabang]
    )
  ) {
    console.log(
      `[WhatsApp] Client ${cabang} tidak ada atau disconnected/error. Membuat ulang...`
    );
    return createClient(cabang);
  }
  return clients[cabang];
};

const getClientStatus = async (cabang) => {
  const client = getClient(cabang); // Panggil getClient untuk trigger createClient jika perlu
  const status = clientStatus[cabang] || "NOT_INITIALIZED";
  const qr = qrCodes[cabang];

  // Coba dapatkan status real-time jika memungkinkan (jika client sudah terinisialisasi)
  let realTimeState = null;
  try {
    if (client && typeof client.getState === "function") {
      realTimeState = await client.getState(); // Bisa null, 'PAIRING', 'CONNECTED', 'TIMEOUT', etc.
      console.log(`[WhatsApp] Real-time state for ${cabang}: ${realTimeState}`);
      // Sinkronkan status internal kita
      if (realTimeState === "CONNECTED" && status !== "READY") {
        clientStatus[cabang] = "READY";
        delete qrCodes[cabang];
      } else if (realTimeState === "PAIRING" && status !== "QR_RECEIVED") {
        // Jika state pairing tapi QR tidak ada, mungkin perlu generate ulang
        // Untuk sekarang, biarkan status internal
      } else if (!realTimeState && status === "READY") {
        // Mungkin disconnected
        clientStatus[cabang] = "DISCONNECTED";
        delete clients[cabang];
      }
    }
  } catch (error) {
    console.warn(
      `[WhatsApp] Gagal mendapatkan state real-time untuk ${cabang}:`,
      error.message
    );
    // Jika error state, anggap disconnected
    if (status === "READY") {
      clientStatus[cabang] = "DISCONNECTED";
      delete clients[cabang];
    }
  }

  return {
    status: clientStatus[cabang] || "NOT_INITIALIZED", // Kembalikan status internal terbaru
    qrDataUrl: qrCodes[cabang] || null, // Kembalikan QR jika ada
    message: getStatusMessage(clientStatus[cabang], cabang),
  };
};

const getStatusMessage = (status, cabang) => {
  switch (status) {
    case "INITIALIZING":
      return "Sedang menginisialisasi koneksi...";
    case "QR_RECEIVED":
      return `Pindai QR Code untuk menghubungkan WhatsApp Cabang ${cabang}.`;
    case "READY":
      return `WhatsApp untuk Cabang ${cabang} sudah terhubung.`;
    case "DISCONNECTED":
      return `WhatsApp untuk Cabang ${cabang} terputus. Coba muat ulang.`;
    case "AUTH_FAILURE":
      return `Gagal otentikasi untuk Cabang ${cabang}. Hapus sesi dan coba lagi.`;
    case "ERROR_INIT":
      return `Gagal memulai WhatsApp untuk Cabang ${cabang}.`;
    default:
      return `Status tidak diketahui untuk Cabang ${cabang}.`;
  }
};

const removeSessionFiles = (cabang) => {
  // JANGAN sanitize KECUALI Anda juga sanitize di new LocalAuth({ clientId: ... })
  // const clientId = sanitizeClientId(cabang);

  // Gunakan 'cabang' MENTAH sebagai bagian dari nama folder, SAMA seperti di LocalAuth
  const sessionFolderName = `session-${cabang}`; // <-- Gunakan 'cabang' langsung
  const sessionPath = path.join(".wwebjs_auth", sessionFolderName);

  // Tambahkan log path absolut untuk debugging
  console.log(
    `[WhatsApp] Mencoba menghapus path sesi: ${path.resolve(sessionPath)}`
  );

  try {
    if (fs.existsSync(sessionPath)) {
      console.log(`[WhatsApp] Menghapus folder sesi: ${sessionPath}`);
      fs.rmSync(sessionPath, { recursive: true, force: true });
      return true;
    } else {
      // Ini akan muncul jika path memang salah atau folder sudah dihapus sebelumnya
      console.log(`[WhatsApp] Folder sesi tidak ditemukan: ${sessionPath}`);
      return false;
    }
  } catch (error) {
    // Error ini biasanya karena masalah izin (permissions)
    console.error(
      `[WhatsApp] Gagal menghapus folder sesi ${sessionPath}:`,
      error
    );
    return false;
  }
};

const logoutClient = async (cabang) => {
  const client = clients[cabang];
  if (client) {
    console.log(`[WhatsApp] Logout client untuk ${cabang}...`);
    try {
      await client.logout(); // Coba logout graceful
      console.log(`[WhatsApp] Logout client ${cabang} berhasil.`);
    } catch (error) {
      console.warn(
        `[WhatsApp] Error saat logout client ${cabang} (mungkin sudah disconnected):`,
        error.message
      );
      // Tetap lanjutkan proses penghapusan
    } finally {
      // Pastikan destroy dipanggil untuk membersihkan puppeteer
      if (typeof client.destroy === "function") {
        await client
          .destroy()
          .catch((err) =>
            console.error(`[WhatsApp] Error destroying client ${cabang}:`, err)
          );
      }
      delete clients[cabang]; // Hapus dari memori
      delete qrCodes[cabang];
      clientStatus[cabang] = "DISCONNECTED"; // Set status
    }
  } else {
    console.log(
      `[WhatsApp] Client ${cabang} tidak ditemukan di memori untuk logout.`
    );
    clientStatus[cabang] = "DISCONNECTED"; // Pastikan statusnya disconnected
  }

  // Selalu coba hapus file sesi
  const filesRemoved = removeSessionFiles(cabang);

  if (filesRemoved) {
    return {
      success: true,
      message: `Sesi WhatsApp untuk cabang ${cabang} berhasil dihapus.`,
    };
  } else {
    // Jika client tidak ada DAN file tidak ada, anggap sudah terhapus
    if (!client) {
      return {
        success: true,
        message: `Sesi WhatsApp untuk cabang ${cabang} tidak ditemukan (dianggap sudah dihapus).`,
      };
    }
    return {
      success: false,
      message: `Gagal menghapus file sesi untuk cabang ${cabang}.`,
    };
  }
};

// --- Fungsi untuk Mengirim Struk ---
// whatsappService.js
const sendReceipt = async (cabang, nomorInvoice, nomorHp, token) => {
  const client = getClient(cabang);

  await new Promise((resolve) => {
    client.on("ready", resolve);
    if (client.info) resolve(); // Jika sudah siap, langsung resolve
  });

  const page = await client.pupBrowser.newPage();
  try {
    // Inject token ke localStorage sebelum halaman dijalankan
    await page.evaluateOnNewDocument((authToken) => {
      localStorage.setItem("authToken", authToken);
    }, token);

    const url = `${process.env.FRONTEND_URL}/transaksi/penjualan/invoice/image-kasir/${nomorInvoice}?source=whatsapp`;

    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // beri jeda ekstra supaya JS di frontend sempat baca localStorage & render
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const receiptElement = await page.$(".receipt");
    if (!receiptElement) {
      throw new Error(
        "Elemen .receipt tidak ditemukan. Periksa output HTML di atas."
      );
    }

    const tempDir = path.join(__dirname, "../temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const imageBuffer = await receiptElement.screenshot();
    const tempPath = path.join(__dirname, `../temp/${nomorInvoice}.png`);
    fs.writeFileSync(tempPath, imageBuffer);

    const chatId = `${nomorHp}@c.us`;
    const media = MessageMedia.fromFilePath(tempPath);
    await client.sendMessage(chatId, media, {
      caption: `Struk Transaksi No. ${nomorInvoice}`,
    });
    fs.unlinkSync(tempPath);

    return { success: true, message: `Struk berhasil dikirim ke ${nomorHp}` };
  } catch (error) {
    console.error("[WHATSAPP SERVICE ERROR]", error);
    throw error;
  } finally {
    await page.close();
  }
};

module.exports = {
  getClient,
  getClientStatus,
  sendReceipt,
  logoutClient,
};
