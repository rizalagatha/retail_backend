const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

// Objek untuk menyimpan semua instance klien WA, dengan key berupa kode cabang
const clients = {};
// Objek untuk menyimpan QR code yang sedang aktif
const qrCodes = {};

const sanitizeClientId = (cabang) => {
    // ganti karakter non-alfanumerik jadi underscore
    return cabang.replace(/[^a-zA-Z0-9_-]/g, "_");
};

// --- Inisialisasi Client ---
const createClient = (cabang) => {
    const clientId = sanitizeClientId(cabang);
    console.log(`[WhatsApp] Membuat client baru untuk cabang: ${clientId}`);

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: cabang }), // <-- Kunci: Session disimpan per cabang
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }
    });

    client.on('qr', async (qr) => {
        console.log(`[WhatsApp] QR Code diterima untuk ${cabang}`);
        // Ubah QR menjadi data URL agar bisa dikirim via API
        qrCodes[cabang] = await qrcode.toDataURL(qr);
    });

    client.on('ready', () => {
        console.log(`[WhatsApp] Client untuk ${cabang} sudah siap!`);
        delete qrCodes[cabang]; // Hapus QR setelah siap
    });

    client.on('auth_failure', msg => {
        console.error(`[WhatsApp] Gagal otentikasi untuk ${cabang}:`, msg);
    });

    client.on('disconnected', (reason) => {
        console.warn(`[WhatsApp] Disconnected untuk ${cabang}:`, reason);
    });

    client.initialize();
    clients[cabang] = client;
    return client;
};

const getClient = (cabang) => {
    if (!clients[cabang]) {
        return createClient(cabang);
    }
    return clients[cabang];
};

const getQrCode = (cabang) => {
    return qrCodes[cabang];
};

// --- Fungsi untuk Mengirim Struk ---
// whatsappService.js
const sendReceipt = async (cabang, nomorInvoice, nomorHp, token) => {
    const client = getClient(cabang);

    await new Promise(resolve => {
        client.on('ready', resolve);
        if (client.info) resolve(); // Jika sudah siap, langsung resolve
    });

    const page = await client.pupBrowser.newPage();
    try {
        // Inject token ke localStorage sebelum halaman dijalankan
        await page.evaluateOnNewDocument((authToken) => {
            localStorage.setItem('authToken', authToken);
        }, token);

        const url = `${process.env.FRONTEND_URL}/transaksi/penjualan/invoice/image-kasir/${nomorInvoice}?source=whatsapp`;

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // beri jeda ekstra supaya JS di frontend sempat baca localStorage & render
        await new Promise(resolve => setTimeout(resolve, 2000));

        const receiptElement = await page.$('.receipt');
        if (!receiptElement) {
            throw new Error("Elemen .receipt tidak ditemukan. Periksa output HTML di atas.");
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
        await client.sendMessage(chatId, media, { caption: `Struk Transaksi No. ${nomorInvoice}` });
        fs.unlinkSync(tempPath);

        return { success: true, message: `Struk berhasil dikirim ke ${nomorHp}` };
    } catch (error) {
        console.error('[WHATSAPP SERVICE ERROR]', error);
        throw error;
    } finally {
        await page.close();
    }
};

module.exports = {
    getClient,
    getQrCode,
    sendReceipt,
};