const offerFormService = require("../services/offerFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getNextNumber = async (req, res) => {
  try {
    const { cabang, tanggal } = req.query;
    if (!cabang || !tanggal) {
      return res
        .status(400)
        .json({ message: "Parameter cabang dan tanggal diperlukan." });
    }
    const nextNumber = await offerFormService.generateNewOfferNumber(
      pool, // Pass pool connection
      cabang,
      tanggal
    );
    res.json({ nextNumber });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchCustomers = async (req, res) => {
  try {
    const { term, gudang, page, itemsPerPage, isInvoice } = req.query; // Ambil isInvoice di sini
    const pageNumber = parseInt(page, 10) || 1;
    const limit = parseInt(itemsPerPage, 10) || 10;

    const result = await offerFormService.searchCustomers(
      term || "",
      gudang,
      pageNumber,
      limit,
      isInvoice // <--- Harus dikirim ke service!
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getCustomerDetails = async (req, res) => {
  try {
    const { kode } = req.params;
    // Tambahkan parameter gudang jika diperlukan oleh service (berdasarkan kode service Anda butuh gudang)
    // Asumsi frontend mengirim gudang via query atau kita ambil dari user cabang jika tidak ada
    const gudang = req.query.gudang || req.user.cabang;

    const details = await offerFormService.getCustomerDetails(kode, gudang);
    if (details) {
      res.json(details);
    } else {
      res.status(404).json({ message: "Customer tidak ditemukan." });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const saveOffer = async (req, res) => {
  try {
    const payload = req.body;

    // 1. DETEKSI: Apakah ini Update?
    const isUpdate = payload.isNew === false;
    const nomorDokumen = payload.header?.nomor || payload.nomor;

    let oldData = null;

    // 2. SNAPSHOT: Ambil data lama LENGKAP jika Update
    if (isUpdate && nomorDokumen) {
      try {
        // A. Ambil Header
        const [headerRows] = await pool.query(
          "SELECT * FROM tpenawaran_hdr WHERE pen_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Ambil Detail (Gunakan pend_nomor)
          const [detailRows] = await pool.query(
            "SELECT * FROM tpenawaran_dtl WHERE pend_nomor = ? ORDER BY pend_nourut",
            [nomorDokumen]
          );

          // C. Gabungkan
          oldData = {
            ...header,
            items: detailRows
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save offer:", e.message);
      }
    }

    // 3. PROSES: Simpan ke Database
    // Inject user info ke payload agar service bisa membacanya
    payload.user = req.user;

    const result = await offerFormService.saveOffer(payload);

    // 4. AUDIT: Catat Log
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";

    auditService.logActivity(
      req,
      action,
      "PENAWARAN",
      targetId,
      oldData, // Data Lama (Header + Items)
      payload, // Data Baru (Payload Form)
      `${action === "CREATE" ? "Input" : "Edit"} Penawaran`
    );

    const statusCode = payload.isNew ? 201 : 200;
    res.status(statusCode).json(result);
  } catch (error) {
    console.error("Error saving offer:", error);
    res
      .status(500)
      .json({ message: error.message || "Gagal menyimpan penawaran." });
  }
};

const getDefaultDiscount = async (req, res) => {
  try {
    const { level, total, gudang } = req.query;

    const result = await offerFormService.getDefaultDiscount(
      level,
      parseFloat(total),
      gudang
    );

    res.status(200).json(result);
  } catch (error) {
    console.error("Error di Controller getDefaultDiscount:", error);
    res.status(500).json({
      message: "Gagal mengambil data diskon default",
      error: error.message,
    });
  }
};

const getDetailsForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await offerFormService.getOfferForEdit(nomor);
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

const searchSoDtf = async (req, res) => {
  try {
    const { cabang, customerKode } = req.query;
    if (!cabang || !customerKode) {
      return res
        .status(400)
        .json({ message: "Parameter cabang dan customer diperlukan." });
    }
    const data = await offerFormService.searchAvailableSoDtf(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSoDtfDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await offerFormService.getSoDtfDetailsForSo(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchPriceProposals = async (req, res) => {
  try {
    const { cabang, customerKode } = req.query;
    if (!cabang || !customerKode) {
      return res
        .status(400)
        .json({ message: "Parameter cabang dan customer diperlukan." });
    }
    const data = await offerFormService.searchApprovedPriceProposals(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPriceProposalDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await offerFormService.getPriceProposalDetailsForSo(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await offerFormService.getDataForPrint(nomor);
    if (!data) {
      return res
        .status(404)
        .json({ message: "Data penawaran tidak ditemukan." });
    }
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    const { gudang } = req.query;
    if (!gudang) {
      return res.status(400).json({ message: "Parameter gudang diperlukan." });
    }
    const product = await offerFormService.findByBarcode(barcode, gudang);
    res.json(product);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

module.exports = {
  getNextNumber,
  searchCustomers,
  getCustomerDetails,
  saveOffer,
  getDefaultDiscount,
  getDetailsForEdit,
  searchSoDtf,
  getSoDtfDetails,
  searchPriceProposals,
  getPriceProposalDetails,
  getPrintData,
  getByBarcode,
};
