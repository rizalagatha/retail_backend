const service = require("../services/authPinService");

const authorizationController = {
  // [SALES] Mengirim permintaan otorisasi baru
  createRequest: async (req, res) => {
    try {
      const { transaksi, jenis, keterangan, nominal } = req.body;

      // Validasi input dasar
      if (!jenis || !keterangan) {
        return res
          .status(400)
          .json({ message: "Jenis dan Keterangan wajib diisi." });
      }

      // Ambil data user dari Token (req.user diset oleh middleware verifyToken)
      const payload = {
        transaksi,
        jenis,
        keterangan,
        nominal,
        cabang: req.user.cabang, // Otomatis dari token login
        user: req.user.kode, // Otomatis dari token login
      };

      const result = await service.createRequest(payload);
      res.status(201).json(result);
    } catch (error) {
      console.error("Error createRequest:", error);
      res.status(500).json({ message: "Gagal membuat permintaan otorisasi." });
    }
  },

  // [FRONTEND] Cek status otorisasi (untuk polling)
  checkStatus: async (req, res) => {
    try {
      const { nomor } = req.params;
      const result = await service.checkStatus(nomor);
      res.json(result);
    } catch (error) {
      // Jika data belum ada atau error lain
      res.status(404).json({ message: error.message });
    }
  },

  // [MANAGER] Mengambil daftar request yang pending
  getPending: async (req, res) => {
    try {
      // Manager hanya bisa melihat request di cabangnya sendiri
      const cabang = req.user.cabang;
      const rows = await service.getPendingRequests(cabang);
      res.json(rows);
    } catch (error) {
      console.error("Error getPending:", error);
      res.status(500).json({ message: "Gagal memuat data otorisasi." });
    }
  },

  // [MANAGER] Melakukan Approve / Reject
  processRequest: async (req, res) => {
    try {
      const { authNomor, action } = req.body; // action: 'APPROVE' atau 'REJECT'
      const managerUser = req.user.kode;

      if (!authNomor || !["APPROVE", "REJECT"].includes(action)) {
        return res.status(400).json({ message: "Data proses tidak valid." });
      }

      const result = await service.processRequest(
        authNomor,
        managerUser,
        action
      );
      res.json(result);
    } catch (error) {
      console.error("Error processRequest:", error);
      res.status(500).json({ message: error.message });
    }
  },
};

module.exports = authorizationController;
