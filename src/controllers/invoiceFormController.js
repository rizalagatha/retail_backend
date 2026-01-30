const service = require("../services/invoiceFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const detectQtyAnomaly = async (soNomor, invoiceItems) => {
  if (!soNomor || !Array.isArray(invoiceItems)) return null;

  try {
    // Ambil detail Qty dari SO asli
    const [soDetails] = await pool.query(
      "SELECT sod_kode, SUM(sod_jumlah) as total_so FROM tso_dtl WHERE sod_so_nomor = ? GROUP BY sod_kode",
      [soNomor],
    );

    const soMap = new Map(
      soDetails.map((d) => [d.sod_kode, Number(d.total_so)]),
    );
    let anomalyNote = "";

    invoiceItems.forEach((item) => {
      const qtySo = soMap.get(item.kode) || 0;
      const qtyInv = Number(item.jumlah);

      if (qtyInv !== qtySo) {
        anomalyNote += `Barang ${item.kode}: SO(${qtySo}) vs Inv(${qtyInv}). `;
      }
    });

    return anomalyNote || null;
  } catch (e) {
    console.warn("Gagal cek anomali Qty SO:", e.message);
    return null;
  }
};

const checkSoDeadline = (dateline) => {
  if (!dateline) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Konversi string ke objek Date
  const deadlineDate = new Date(dateline);

  if (isNaN(deadlineDate.getTime())) return null;

  deadlineDate.setHours(0, 0, 0, 0);

  if (today > deadlineDate) {
    // GUNAKAN deadlineDate (Objek), BUKAN dateline (String)
    const dateString = deadlineDate.toISOString().split("T")[0];
    return `SO Melebihi Batas Waktu (${dateString})`;
  }
  return null;
};

const loadForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.loadForEdit(nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const save = async (req, res) => {
  try {
    const payload = req.body;
    const soNomor = payload.so_nomor || payload.header?.so_nomor;
    const dateline = payload.header?.dateline; // Pastikan dikirim dari frontend

    // 1. Deteksi Anomali (Qty & Dateline)
    const qtyAnomaly = await detectQtyAnomaly(soNomor, payload.items);
    const dateAnomaly = checkSoDeadline(dateline);

    // 2. PROSES: Simpan ke DB
    const result = await service.saveData(payload, req.user);

    // 3. AUDIT: Catat jika ada anomali Qty atau Tanggal
    if (qtyAnomaly || dateAnomaly) {
      let finalNote = "";
      if (qtyAnomaly) finalNote += `SELISIH QTY: ${qtyAnomaly} `;
      if (dateAnomaly) finalNote += `DEADLINE TERLEWATI: ${dateAnomaly}`;

      auditService.logActivity(
        req,
        "ANOMALY_INVOICE_FROM_SO",
        "INVOICE",
        result.nomor || "UNKNOWN",
        null,
        payload,
        `⚠️ ANOMALI PROSES SO: ${finalNote.trim()}`,
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const searchSo = async (req, res) => {
  try {
    // Ambil dan konversi parameter dari query string
    const { term, page = 1, itemsPerPage = 10 } = req.query;
    const data = await service.searchSo(
      term,
      Number(page),
      Number(itemsPerPage),
      req.user,
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSoDetailsForGrid = async (req, res) => {
  try {
    const { soNomor } = req.params;
    const data = await service.getSoDetailsForGrid(soNomor, req.user);

    // Deteksi keterlambatan untuk info di UI
    const overdueNote = checkSoDeadline(data.header.dateline);
    data.header.isOverdue = !!overdueNote;
    data.header.overdueNote = overdueNote;

    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const searchUnpaidDp = async (req, res) => {
  try {
    const { customerKode } = req.params;
    const data = await service.searchUnpaidDp(customerKode, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSalesCounters = async (req, res) => {
  try {
    // Teruskan req.user ke service
    const data = await service.getSalesCounters(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchPromo = async (req, res) => {
  try {
    const data = await service.searchPromo(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getMemberByHp = async (req, res) => {
  try {
    const data = await service.getMemberByHp(req.params.hp);
    if (data) {
      res.json(data);
    } else {
      res.status(404).json({ message: "Member tidak ditemukan." });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const saveMember = async (req, res) => {
  try {
    const result = await service.saveMember(req.body, req.user);
    // Log Activity dihapus karena tindakan rutin
    res.json({
      message: `Member ${result.nama} berhasil disimpan.`,
      savedMember: result,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getDefaultCustomer = async (req, res) => {
  try {
    // Ambil cabang dari user atau fallback ke query parameter
    const cabang = req.user?.cabang || req.query.cabang;

    if (!cabang) {
      return res.json(null);
    }

    const data = await service.getDefaultCustomer(cabang);
    res.json(data);
  } catch (error) {
    console.error("Error in getDefaultCustomer:", error);
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

const getByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    const { gudang } = req.query; // Gudang diambil dari query parameter
    if (!gudang) {
      return res.status(400).json({ message: "Parameter gudang diperlukan." });
    }
    const product = await service.findByBarcode(barcode, gudang);
    res.json(product);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const searchProducts = async (req, res) => {
  try {
    const { page = 1, itemsPerPage = 10 } = req.query;
    const result = await service.searchProducts(
      { ...req.query, page: Number(page), itemsPerPage: Number(itemsPerPage) },
      req.user,
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPrintDataKasir = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getPrintDataKasir(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const searchSoDtf = async (req, res) => {
  try {
    const data = await service.searchSoDtf(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSoDtfDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getSoDtfDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const searchReturJual = async (req, res) => {
  try {
    const data = await service.searchReturJual(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const saveSatisfaction = async (req, res) => {
  try {
    const result = await service.saveSatisfaction(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getDiscountRule = async (req, res) => {
  try {
    const { customerKode } = req.params;
    const data = await service.getDiscountRule(customerKode);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPromoBonusItems = async (req, res) => {
  try {
    const { promoNomor } = req.params;
    const data = await service.getPromoBonusItems(promoNomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const validateVoucher = async (req, res) => {
  try {
    const data = await service.validateVoucher(req.body, req.user);
    res.json(data);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getApplicableItemPromo = async (req, res) => {
  try {
    const data = await service.getApplicableItemPromo(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const checkPrintables = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.checkPrintables(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getKuponPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getKuponPrintData(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getVoucherPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getVoucherPrintData(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getDataForSjPrint = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDataForSjPrint(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getActivePromos = async (req, res) => {
  try {
    const data = await service.getActivePromos(req.query, req.user);
    res.json(data);
  } catch (error) {
    console.error("❌ getActivePromos error:", error);
    res.status(500).json({ message: error.message });
  }
};

const getPromoItems = async (req, res) => {
  try {
    const data = await service.getPromoItems(req.params.nomorPromo);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPromoHeader = async (req, res) => {
  try {
    const data = await service.getPromoHeader(req.params.nomorPromo);
    if (!data)
      return res.status(404).json({ message: "Promo tidak ditemukan" });
    res.json(data);
  } catch (e) {
    console.error("getPromoHeader error:", e);
    res.status(500).json({ message: e.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const updateInvoiceHeaderOnly = async (req, res) => {
  try {
    const nomor = req.params.nomor;
    const body = req.body;

    // Snapshot oldData dihapus untuk efisiensi
    const result = await service.updateHeaderOnly(nomor, body, req.user);
    // Log Activity dihapus karena tindakan rutin admin [cite: 2025-09-06]
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchSj = async (req, res) => {
  try {
    // Teruskan seluruh req.query (termasuk page dan itemsPerPage)
    const data = await service.searchSj(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSjDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getSjDetails(nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getCustomerDebt = async (req, res) => {
  try {
    const { kode } = req.params;
    if (!kode) {
      return res.status(400).json({ message: "Kode customer diperlukan." });
    }

    const totalDebt = await service.getCustomerDebt(kode);

    res.json({
      customerKode: kode,
      totalDebt: Number(totalDebt),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  loadForEdit,
  save,
  searchSo,
  getSoDetailsForGrid,
  searchUnpaidDp,
  getSalesCounters,
  searchPromo,
  getMemberByHp,
  saveMember,
  getDefaultCustomer,
  getPrintData,
  getByBarcode,
  searchProducts,
  getPrintDataKasir,
  searchSoDtf,
  getSoDtfDetails,
  searchReturJual,
  saveSatisfaction,
  getDiscountRule,
  getPromoBonusItems,
  validateVoucher,
  getApplicableItemPromo,
  checkPrintables,
  getKuponPrintData,
  getVoucherPrintData,
  getDataForSjPrint,
  getActivePromos,
  getPromoItems,
  getPromoHeader,
  updateInvoiceHeaderOnly,
  searchSj,
  getSjDetails,
  getCustomerDebt,
};
