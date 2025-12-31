const soFormService = require("../services/soFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await soFormService.getSoForEdit(nomor);
    if (data) {
      res.json(data);
    } else {
      res.status(404).json({ message: "Data Surat Pesanan tidak ditemukan." });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
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
          "SELECT * FROM tso_hdr WHERE so_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Ambil Detail (Gunakan sod_so_nomor)
          const [detailRows] = await pool.query(
            "SELECT * FROM tso_dtl WHERE sod_so_nomor = ? ORDER BY sod_nourut",
            [nomorDokumen]
          );

          // C. Gabungkan
          oldData = {
            ...header,
            items: detailRows
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save SO:", e.message);
      }
    }

    // 3. PROSES: Simpan ke Database
    const result = await soFormService.save(payload, req.user);

    // 4. AUDIT: Catat Log
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";

    auditService.logActivity(
      req,
      action,
      "SURAT_PESANAN",
      targetId,
      oldData, // Data Lama (Header + Items)
      payload, // Data Baru (Payload Form)
      `${action === "CREATE" ? "Input" : "Edit"} SO (Customer: ${payload.header?.customer?.nama})`
    );

    res.status(payload.isNew ? 201 : 200).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const searchPenawaran = async (req, res) => {
  try {
    const data = await soFormService.searchAvailablePenawaran(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPenawaranDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await soFormService.getPenawaranDetailsForSo(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDefaultDiscount = async (req, res) => {
  try {
    const { level, total, gudang } = req.query;
    const levelCode = level ? level.split(" - ")[0] : "";
    const result = await soFormService.getDefaultDiscount(
      levelCode,
      total,
      gudang
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchSetoran = async (req, res) => {
  try {
    const data = await soFormService.searchAvailableSetoran(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const saveDp = async (req, res) => {
  try {
    const result = await soFormService.saveNewDp(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const searchRekening = async (req, res) => {
  try {
    const data = await soFormService.searchRekening(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDpPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await soFormService.getDataForDpPrint(nomor);
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
    const product = await soFormService.findByBarcode(barcode, gudang);
    res.json(product);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const searchJenisOrder = async (req, res) => {
  try {
    const term = req.query.term || "";
    const result = await soFormService.searchJenisOrder(term);
    res.json(result);
  } catch (error) {
    console.error("searchJenisOrder error:", error);
    res.status(500).json({ message: error.message });
  }
};

const hitungHarga = async (req, res) => {
  try {
    const result = await soFormService.hitungHarga(req.body);
    res.json({ items: result });
  } catch (error) {
    console.error("hitungHarga error:", error);
    res.status(500).json({ message: error.message });
  }
};

const calculateHargaCustom = async (req, res) => {
  try {
    const result = await soFormService.calculateHargaCustom(req.body);
    res.json(result);
  } catch (error) {
    console.error("Error calculateHargaCustom:", error);
    res.status(500).json({ message: "Gagal menghitung harga custom" });
  }
};

const deleteDp = async (req, res) => {
  try {
    const { nomor } = req.body;
    const result = await soFormService.deleteDp(nomor);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getForEdit,
  save,
  searchPenawaran,
  getPenawaranDetails,
  getDefaultDiscount,
  searchSetoran,
  saveDp,
  searchRekening,
  getDpPrintData,
  getByBarcode,
  searchJenisOrder,
  hitungHarga,
  calculateHargaCustom,
  deleteDp,
};
