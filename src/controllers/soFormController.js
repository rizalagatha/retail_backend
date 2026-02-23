const soFormService = require("../services/soFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot
const { differenceInDays, parseISO, format } = require("date-fns");

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
    const isUpdate = payload.isNew === false;
    const nomorDokumen = payload.header?.nomor;
    let oldData = null;
    let anomalyDetected = false;
    let anomalyNote = "";

    // 1. SNAPSHOT & DETEKSI PERUBAHAN BARANG (Hanya saat Update)
    if (isUpdate && nomorDokumen) {
      const [headerRows] = await pool.query(
        "SELECT * FROM tso_hdr WHERE so_nomor = ?",
        [nomorDokumen],
      );
      const [detailRows] = await pool.query(
        "SELECT * FROM tso_dtl WHERE sod_so_nomor = ?",
        [nomorDokumen],
      );

      if (headerRows.length > 0) {
        oldData = { ...headerRows[0], items: detailRows };

        // Cek apakah ada perubahan pada daftar barang (Kode, Qty, atau Harga)
        const oldItems = oldData.items;
        const newItems = payload.details || [];

        if (oldItems.length !== newItems.length) {
          anomalyDetected = true;
          anomalyNote += "Jumlah baris item berubah. ";
        } else {
          for (let i = 0; i < oldItems.length; i++) {
            const match = newItems.find(
              (ni) => ni.kode === oldItems[i].sod_kode,
            );
            if (
              !match ||
              match.jumlah != oldItems[i].sod_jumlah ||
              match.harga != oldItems[i].sod_harga
            ) {
              anomalyDetected = true;
              anomalyNote += `Perubahan data pada barang ${oldItems[i].sod_kode}. `;
              break;
            }
          }
        }
      }
    }

    // 2. PROSES SIMPAN
    const result = await soFormService.save(payload, req.user);

    // 3. AUDIT: Hanya catat jika ini CREATE atau ada Anomali pada UPDATE
    if (!isUpdate || anomalyDetected) {
      auditService.logActivity(
        req,
        anomalyDetected ? "ANOMALY_UPDATE" : "CREATE",
        "SURAT_PESANAN",
        result.nomor || nomorDokumen,
        oldData,
        payload,
        anomalyDetected ? `⚠️ ANOMALI: ${anomalyNote}` : `Input SO Baru`,
      );
    }

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
    const { cabang } = req.query;

    const result = await soFormService.getPenawaranDetailsForSo(nomor, cabang);

    // --- LOGIKA AUDIT (Tetap dipertahankan untuk mendeteksi penawaran kadaluwarsa) ---
    const rawDate = result.header.pen_tanggal;
    let tglPenawaran;

    if (rawDate instanceof Date) {
      tglPenawaran = rawDate;
    } else if (typeof rawDate === "string") {
      tglPenawaran = parseISO(rawDate);
    } else {
      tglPenawaran = new Date();
    }

    const hariIni = new Date();
    const selisihHari = differenceInDays(hariIni, tglPenawaran);

    if (selisihHari > 20) {
      auditService.logActivity(
        req,
        "ANOMALY_OLD_OFFER",
        "PENAWARAN",
        nomor,
        null,
        { selisihHari },
        `⚠️ ANOMALI: Menarik penawaran berumur ${selisihHari} hari (Batas 20 hari)`,
      );
    }

    // --- PERBAIKAN UTAMA: OVERRIDE TANGGAL UNTUK FRONTEND ---
    // Kita paksa tanggal penawaran yang dikirim ke form SO menjadi tanggal hari ini.
    result.pen_tanggal = format(new Date(), "yyyy-MM-dd");

    // Kirim hasil ke frontend
    res.json(result);
  } catch (error) {
    console.error("getPenawaranDetails Error:", error);
    res.status(500).json({ message: error.message });
  }
};

const getDefaultDiscount = async (req, res) => {
  try {
    const { level, total, gudang } = req.query;

    // Pastikan 'level' adalah string sebelum split
    const levelStr = String(level || "");
    const levelCode = levelStr ? levelStr.split(" - ")[0] : "";

    const result = await soFormService.getDefaultDiscount(
      levelCode,
      total,
      gudang,
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
