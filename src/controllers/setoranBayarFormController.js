const service = require("../services/setoranBayarFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const loadForEdit = async (req, res) => {
  try {
    const data = await service.loadForEdit(req.params.nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const save = async (req, res) => {
  try {
    const payload = req.body;

    // 1. DETEKSI: Apakah ini Update?
    const isUpdate = payload.isNew === false;
    const nomorDokumen = payload.header?.nomor;

    let oldData = null;

    // 2. SNAPSHOT: Ambil data lama LENGKAP jika Update
    if (isUpdate && nomorDokumen) {
      try {
        // A. Ambil Header
        const [headerRows] = await pool.query(
          "SELECT * FROM tsetor_hdr WHERE sh_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Ambil Detail (Gunakan sd_sh_nomor)
          const [detailRows] = await pool.query(
            "SELECT * FROM tsetor_dtl WHERE sd_sh_nomor = ? ORDER BY sd_nourut",
            [nomorDokumen]
          );

          // C. Gabungkan
          oldData = {
            ...header,
            items: detailRows
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save setoran:", e.message);
      }
    }

    // 3. PROSES: Simpan ke Database
    const result = await service.saveData(payload, req.user);

    // 4. AUDIT: Catat Log
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";
    const note = payload.header?.nomorSo
      ? `Input DP untuk SO: ${payload.header.nomorSo}`
      : `${action === "CREATE" ? "Input" : "Edit"} Pembayaran Piutang`;

    auditService.logActivity(
      req,
      action,
      "SETORAN_BAYAR",
      targetId,
      oldData, // Data Lama (Header + Items)
      payload, // Data Baru (Payload Form)
      note
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const searchUnpaidInvoices = async (req, res) => {
  try {
    const { term, page = 1, itemsPerPage = 10, customerKode } = req.query;
    if (!customerKode) {
      return res.status(400).json({ message: "Kode customer diperlukan." });
    }

    const result = await service.searchUnpaidInvoices(
      term,
      Number(page),
      Number(itemsPerPage),
      customerKode,
      req.user
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getPrintData(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const searchSoForSetoran = async (req, res) => {
  try {
    const {
      customer,
      cabang,
      term = "",
      page = 1,
      itemsPerPage = 10,
    } = req.query;

    if (!customer) {
      return res
        .status(400)
        .json({ message: "Parameter 'customer' wajib diisi." });
    }

    const result = await service.searchSoForSetoran({
      customer,
      cabang,
      term,
      page: Number(page),
      itemsPerPage: Number(itemsPerPage),
    });

    res.json(result);
  } catch (error) {
    console.error("searchSoForSetoran error:", error);
    res.status(500).json({ message: error.message });
  }
};

const getSoDetails = async (req, res) => {
  try {
    const nomorSo = req.params.nomor;
    if (!nomorSo)
      return res.status(400).json({ message: "Nomor SO diperlukan." });

    const data = await service.getSoDetails(nomorSo, req.user);
    if (!data) return res.status(404).json({ message: "SO tidak ditemukan." });

    res.json(data);
  } catch (error) {
    console.error("getSoDetails error:", error);
    res.status(500).json({ message: "Gagal memuat data SO." });
  }
};

const getInvoicesFromSo = async (req, res) => {
  try {
    const nomorSo = req.query.nomorSo;
    if (!nomorSo)
      return res.status(400).json({ message: "Nomor SO diperlukan." });

    const result = await service.getInvoicesFromSo(nomorSo);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Gagal mengambil invoice dari SO." });
  }
};

module.exports = {
  loadForEdit,
  save,
  searchUnpaidInvoices,
  getPrintData,
  searchSoForSetoran,
  getSoDetails,
  getInvoicesFromSo,
};
