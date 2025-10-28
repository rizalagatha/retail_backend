// Di whatsappController.js
const whatsappService = require("../services/whatsappService");
const pool = require("../config/database"); // Untuk ambil cabang user jika perlu

// Controller untuk mendapatkan QR code atau status
const getStatus = async (req, res) => {
  try {
    // Ambil cabang dari user yang login
    const cabang = req.user.cabang;
    if (!cabang) {
      return res.status(400).json({ message: "Cabang user tidak ditemukan." });
    }
    const statusInfo = await whatsappService.getClientStatus(cabang);
    res.json(statusInfo);
  } catch (error) {
    console.error("[WhatsApp Controller] Error getStatus:", error);
    res
      .status(500)
      .json({ message: error.message || "Gagal mendapatkan status WhatsApp." });
  }
};

// Controller untuk mengirim struk
const sendReceipt = async (req, res) => {
  const { nomor, hp } = req.body;
  const cabang = req.user.cabang;
  const token = req.headers.authorization?.split(" ")[1]; // Ambil token dari header

  if (!nomor || !hp || !cabang || !token) {
    return res
      .status(400)
      .json({ message: "Parameter tidak lengkap (nomor, hp, cabang, token)." });
  }

  try {
    const result = await whatsappService.sendReceipt(cabang, nomor, hp, token);
    res.json(result);
  } catch (error) {
    console.error("[WhatsApp Controller] Error sendReceipt:", error);
    res
      .status(500)
      .json({ message: error.message || "Gagal mengirim struk via WhatsApp." });
  }
};

// --- Controller Baru: Logout ---
const logout = async (req, res) => {
  try {
    const cabang = req.user.cabang;
    if (!cabang) {
      return res.status(400).json({ message: "Cabang user tidak ditemukan." });
    }
    const result = await whatsappService.logoutClient(cabang);
    res.json(result);
  } catch (error) {
    console.error("[WhatsApp Controller] Error logout:", error);
    res
      .status(500)
      .json({ message: error.message || "Gagal menghapus sesi WhatsApp." });
  }
};
// -----------------------------

module.exports = {
  getStatus, // <-- Ganti getQr dengan getStatus
  sendReceipt,
  logout, // <-- Tambahkan logout
};
