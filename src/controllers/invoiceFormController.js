const service = require("../services/invoiceFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

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
    // 1. DETEKSI: Apakah ini Create Baru atau Update?
    const isUpdate = req.body.nomor && req.body.nomor !== "AUTO";
    let oldData = null;

    if (isUpdate) {
      try {
        // A. SNAPSHOT HEADER
        const [headerRows] = await pool.query(
          "SELECT * FROM tinv_hdr WHERE inv_nomor = ?",
          [req.body.nomor]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. SNAPSHOT DETAIL [DITAMBAHKAN]
          // Mengambil item barang yang ada di invoice tersebut
          const [detailRows] = await pool.query(
            "SELECT * FROM tinv_dtl WHERE invd_inv_nomor = ? ORDER BY invd_nourut",
            [req.body.nomor]
          );

          // C. GABUNGKAN
          // Masukkan detail ke dalam properti 'items' agar sejajar dengan struktur req.body
          oldData = {
            ...header,
            items: detailRows,
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save invoice:", e.message);
      }
    }

    // 2. PROSES: Simpan ke DB
    const result = await service.saveData(req.body, req.user);

    // 3. AUDIT: Catat Log
    const targetId = result.nomor || req.body.nomor || "UNKNOWN";
    const action = oldData ? "UPDATE" : "CREATE"; // Cek oldData bukan isUpdate agar lebih akurat

    auditService.logActivity(
      req,
      action,
      "INVOICE",
      targetId,
      oldData, // Data lama (Header + Items)
      req.body, // Data baru (Payload Form)
      `${action === "CREATE" ? "Input" : "Edit"} Transaksi Penjualan`
    );

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
      req.user
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

    // Audit sederhana untuk Member
    auditService.logActivity(
      req,
      "SAVE", // Bisa Create atau Update (Upsert)
      "MEMBER",
      result.kode || result.nama, // Target ID
      null, // Kita skip snapshot lama demi performa
      req.body, // Data baru
      `Input/Update Member via Kasir: ${result.nama}`
    );

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
      req.user
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

    if (!body.customer) {
      return res.status(400).json({ message: "Customer tidak boleh kosong." });
    }
    if (!body.tanggal) {
      return res.status(400).json({ message: "Tanggal tidak boleh kosong." });
    }

    // 1. Snapshot Old Data
    let oldData = null;
    try {
      const [rows] = await pool.query(
        "SELECT * FROM tinv_hdr WHERE inv_nomor = ?",
        [nomor]
      );
      if (rows.length > 0) oldData = rows[0];
    } catch (e) {
      console.warn("Gagal snapshot oldData update header:", e.message);
    }

    // 2. Proses Update
    const result = await service.updateHeaderOnly(nomor, body, req.user);

    // 3. Audit Log
    if (oldData) {
      auditService.logActivity(
        req,
        "UPDATE",
        "INVOICE",
        nomor,
        oldData,
        body,
        "Koreksi Header Invoice (Admin)"
      );
    }

    res.json(result);
  } catch (error) {
    console.error("[updateInvoiceHeaderOnly]", error);
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
