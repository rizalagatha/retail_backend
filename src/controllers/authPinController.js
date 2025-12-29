const service = require("../services/authPinService");

const authorizationController = {
  createRequest: async (req, res) => {
    try {
      // [UPDATE] Ambil target_cabang dari body
      const { transaksi, jenis, keterangan, nominal, target_cabang, barcode } =
        req.body;

      if (!jenis || !keterangan) {
        return res
          .status(400)
          .json({ message: "Jenis dan Keterangan wajib diisi." });
      }

      const payload = {
        transaksi,
        jenis,
        keterangan,
        nominal,
        barcode,
        target_cabang, // <-- Teruskan ke service
        cabang: req.user.cabang, // Cabang asal (Requester)
        user: req.user.kode, // User asal (Requester)
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

  getPending: async (req, res) => {
    try {
      // req.user.cabang otomatis terisi dari token login
      const rows = await service.getPendingRequests(req.user.cabang);
      res.json({ success: true, data: rows }); // Format response konsisten
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
