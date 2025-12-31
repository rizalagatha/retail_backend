const sjFormService = require("../services/suratJalanFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getItemsForLoad = async (req, res) => {
  try {
    const { nomor, gudang } = req.query;
    if (!nomor || !gudang) {
      return res.status(400).json({ message: "Nomor dan Gudang diperlukan." });
    }
    const data = await sjFormService.getItemsForLoad(nomor, gudang);
    res.json(data);
  } catch (error) {
    res.status(400).json({ message: error.message });
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
          "SELECT * FROM tdc_sj_hdr WHERE sj_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Ambil Detail (Gunakan sjd_nomor)
          const [detailRows] = await pool.query(
            "SELECT * FROM tdc_sj_dtl WHERE sjd_nomor = ? ORDER BY sjd_kode",
            [nomorDokumen]
          );

          // C. Gabungkan
          oldData = {
            ...header,
            items: detailRows
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save SJ:", e.message);
      }
    }

    // 3. PROSES: Simpan ke Database
    const result = await sjFormService.saveData(payload, req.user);

    // 4. AUDIT: Catat Log
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";
    const refDoc = payload.header?.permintaan || payload.header?.packingList || "";

    auditService.logActivity(
      req,
      action,
      "SURAT_JALAN",
      targetId,
      oldData, // Data Lama (Header + Items)
      payload, // Data Baru (Payload Form)
      `${action === "CREATE" ? "Input" : "Edit"} Surat Jalan (Ref: ${refDoc})`
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const loadForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await sjFormService.loadForEdit(nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const searchStores = async (req, res) => {
  try {
    const { term, page, itemsPerPage, excludeBranch } = req.query;
    const data = await sjFormService.searchStores(
      term,
      page,
      itemsPerPage,
      excludeBranch
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchPermintaan = async (req, res) => {
  try {
    const { term, page = 1, itemsPerPage = 10, storeKode } = req.query;
    if (!storeKode) {
      return res.status(400).json({ message: "Kode store diperlukan." });
    }
    const result = await sjFormService.searchPermintaan(
      term,
      Number(page),
      Number(itemsPerPage),
      storeKode
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchTerimaRb = async (req, res) => {
  try {
    const { term, page = 1, itemsPerPage = 10 } = req.query;
    const result = await sjFormService.searchTerimaRb(
      term,
      Number(page),
      Number(itemsPerPage),
      req.user
    );
    res.json(result);
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
    const product = await sjFormService.findByBarcode(barcode, gudang);
    res.json(product);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const loadItemsFromPackingList = async (req, res) => {
  try {
    const { nomor } = req.query;

    if (!nomor) {
      return res
        .status(400)
        .json({ message: "Nomor Packing List wajib dikirim." });
    }

    const data = await sjFormService.loadItemsFromPackingList(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getItemsForLoad,
  save,
  loadForEdit,
  searchStores,
  searchPermintaan,
  searchTerimaRb,
  getByBarcode,
  loadItemsFromPackingList,
};
