const service = require("../services/invoiceService");
const auditService = require("../services/auditService"); // Import Audit Service
const pool = require("../config/database"); // Import Pool untuk ambil snapshot data lama

const getCabangList = async (req, res) => {
  try {
    const data = await service.getCabangList(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getList = async (req, res) => {
  try {
    const data = await service.getList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const { nomor } = req.params;

    // 1. SNAPSHOT: Ambil data Invoice Header sebelum dihapus/divoid
    // Kita butuh ini agar tahu detail invoice apa yang dihapus (Totalnya berapa, customer siapa)
    let oldData = null;
    try {
      const [rows] = await pool.query(
        "SELECT * FROM tinv_hdr WHERE inv_nomor = ?",
        [nomor]
      );
      if (rows.length > 0) oldData = rows[0];
    } catch (err) {
      console.warn(
        "Gagal ambil snapshot oldData untuk audit remove:",
        err.message
      );
    }

    // 2. PROSES: Jalankan service remove (Void Invoice)
    const result = await service.remove(nomor, req.user);

    // 3. AUDIT: Catat aktivitas VOID
    // Dilakukan SETELAH proses sukses
    if (oldData) {
      auditService.logActivity(
        req, // Req (User Info)
        "VOID", // Action (Gunakan VOID atau DELETE)
        "INVOICE", // Module
        nomor, // Target ID
        oldData, // Old Value (Data invoice yg dihapus)
        null, // New Value (Null karena dihapus)
        `Membatalkan/Menghapus Invoice Rp ${Number(
          oldData.inv_grand_total
        ).toLocaleString()}` // Note
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getExportHeader = async (req, res) => {
  try {
    // 1. Ambil User & Query
    const user = req.user;

    // Copy req.query ke variabel baru agar bisa dimodifikasi
    const filters = { ...req.query };

    // 2. [SECURITY] Paksa Filter Cabang
    // Ini LOGIKA PENTING yang tidak ada di exportDetails lama
    if (user.cabang !== "KDC") {
      filters.cabang = user.cabang;
    }

    // 3. Panggil Service (Langsung oper object filters)
    const rows = await service.getExportHeader(filters);

    res.json(rows);
  } catch (error) {
    console.error("Error getExportHeader:", error);
    res.status(500).json({ message: error.message || "Gagal export header." });
  }
};

const exportDetails = async (req, res) => {
  try {
    const data = await service.getExportDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const checkIfInvoiceInFsk = async (req, res) => {
  try {
    const { nomor } = req.params;
    const used = await service.checkIfInvoiceInFsk(nomor);
    res.json({ used });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const changePayment = async (req, res) => {
  try {
    const user = req.user;
    const payload = req.body; // Isinya: nomor, metodeBaru, bank, noRek, alasan

    // 1. SNAPSHOT: Ambil data Invoice Lama
    // KITA HAPUS kolom 'inv_carabayar' karena ternyata tidak ada di tabel.
    // Kita ganti dengan logika deteksi manual.
    const nomorInvoice = payload.inv_nomor || payload.nomor;
    let oldData = null;
    let oldMethod = "UNKNOWN";

    if (nomorInvoice) {
      try {
        // Ambil nominal tunai dan card untuk menentukan metode lama
        const [rows] = await pool.query(
          "SELECT inv_nomor, inv_rptunai, inv_rpcard, inv_nosetor, inv_ket FROM tinv_hdr WHERE inv_nomor = ?", 
          [nomorInvoice]
        );
        
        if (rows.length > 0) {
           const row = rows[0];
           // Deteksi Metode Lama
           // Jika rptunai > 0, berarti TUNAI. Jika rpcard > 0, berarti TRANSFER/EDC.
           if (Number(row.inv_rptunai) > 0) {
              oldMethod = "TUNAI";
           } else if (Number(row.inv_rpcard) > 0) {
              oldMethod = "TRANSFER/EDC";
           } else {
              oldMethod = "KREDIT/LAINNYA";
           }

           // Simpan data lama yang sudah 'dirapikan'
           oldData = {
              ...row,
              cara_bayar_lama: oldMethod // Field buatan sendiri untuk audit
           };
        }
      } catch (err) {
        console.warn("Gagal snapshot oldData changePayment:", err.message);
      }
    }

    // 2. PROSES: Jalankan service update (Service tetap sama, tidak perlu diubah)
    const result = await service.changePaymentMethod(payload, user);

    // 3. AUDIT: Catat perubahan
    if (oldData) {
      // Tentukan Metode Baru dari Payload
      const newMethod = payload.metodeBaru || payload.cara_bayar || 'BARU';
      
      auditService.logActivity(
        req,
        'UPDATE',             
        'INVOICE',            
        nomorInvoice,         
        oldData,              // Old Value (berisi cara_bayar_lama)
        payload,              // New Value (berisi metodeBaru)
        `Ubah Cara Bayar dari ${oldMethod} ke ${newMethod} (Alasan: ${payload.alasan || '-'})` 
      );
    }

    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    console.error("Error changePayment:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Terjadi kesalahan internal server.",
    });
  }
};

module.exports = {
  getCabangList,
  getList,
  getDetails,
  remove,
  getExportHeader,
  exportDetails,
  checkIfInvoiceInFsk,
  changePayment,
};
