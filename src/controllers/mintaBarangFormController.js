const mintaBarangFormService = require("../services/mintaBarangFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const loadForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await mintaBarangFormService.loadForEdit(nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchSo = async (req, res) => {
  try {
    const data = await mintaBarangFormService.searchSo(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSoDetailsForGrid = async (req, res) => {
  try {
    const { soNomor } = req.params;
    const data = await mintaBarangFormService.getSoDetailsForGrid(
      soNomor,
      req.user
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getBufferStokItems = async (req, res) => {
  try {
    const data = await mintaBarangFormService.getBufferStokItems(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const save = async (req, res) => {
  try {
    const payload = req.body;

    // 1. DETEKSI: Apakah ini Update?
    // Cek flag isNew (false berarti update) atau cek keberadaan nomor di header
    // Sesuaikan dengan struktur payload dari frontend Anda (biasanya payload.header.nomor)
    const nomorDokumen = payload.header?.nomor || payload.mt_nomor;
    const isUpdate = payload.isNew === false && nomorDokumen && nomorDokumen !== "AUTO";

    let oldData = null;

    // 2. SNAPSHOT: Jika Update, ambil data lama LENGKAP
    if (isUpdate) {
      try {
        // A. Ambil Header
        const [headerRows] = await pool.query(
          "SELECT * FROM tmintabarang_hdr WHERE mt_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Ambil Detail (Gunakan mtd_nomor)
          const [detailRows] = await pool.query(
            "SELECT * FROM tmintabarang_dtl WHERE mtd_nomor = ?",
            [nomorDokumen]
          );

          // C. Gabungkan
          oldData = {
            ...header,
            items: detailRows
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save minta barang:", e.message);
      }
    }

    // 3. PROSES: Simpan ke Database
    const result = await mintaBarangFormService.save(payload, req.user);

    // 4. AUDIT: Catat Log
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";

    auditService.logActivity(
      req,
      action,
      "MINTA_BARANG",
      targetId,
      oldData, // Data Lama (Header + Items)
      payload, // Data Baru (Payload Form)
      `${action === "CREATE" ? "Input" : "Edit"} Permintaan Barang`
    );

    res.status(payload.isNew ? 201 : 200).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getProductDetails = async (req, res) => {
  try {
    // req.query akan berisi { kode: '...', ukuran: '...' }
    const data = await mintaBarangFormService.getProductDetailsForGrid(
      req.query,
      req.user
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    const { gudang } = req.query; // Gudang diambil dari query parameter
    if (!gudang) {
      return res.status(400).json({ message: "Parameter gudang diperlukan." });
    }
    const product = await mintaBarangFormService.findByBarcode(barcode, gudang);
    res.json(product);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const lookupProducts = async (req, res) => {
  try {
    const data = await mintaBarangFormService.lookupProducts(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  loadForEdit,
  searchSo,
  getSoDetailsForGrid,
  getBufferStokItems,
  save,
  getProductDetails,
  getByBarcode,
  lookupProducts,
};
