const priceProposalService = require("../services/priceProposalService");
const auditService = require("../services/auditService");
const pool = require("../config/database");
const priceProposalFormService = require("../services/priceProposalFormService");
const priceProposalSoService = require("../services/priceProposalSoService");

const getAll = async (req, res) => {
  try {
    // [BARU] Jalankan semua sync status otomatis sebelum ambil data browse.
    // Masing-masing dibungkus try-catch terpisah — kalau satu gagal (misal
    // ada tabel yang belum ada), sync lain & browse tetap jalan.
    for (const syncFn of [
      priceProposalService.syncDcApprovalStatus,
      priceProposalService.syncProduksiStatus,
      priceProposalService.syncBarangDiterimaDcStatus,
      priceProposalService.syncReadyStoreStatus,
    ]) {
      try {
        await syncFn();
      } catch (syncError) {
        console.error("Gagal sync status pengajuan harga:", syncError.message);
      }
    }

    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      cabang: req.query.cabang,
      belumApproval: req.query.belumApproval === "true",
      status: req.query.status || null,
    };

    if (!filters.startDate || !filters.endDate || !filters.cabang) {
      return res
        .status(400)
        .json({ message: "Parameter tanggal dan cabang diperlukan." });
    }

    const proposals = await priceProposalService.getPriceProposals(filters);
    res.json(proposals);
  } catch (error) {
    console.error("Error in getPriceProposals controller:", error);
    res.status(500).json({ message: "Terjadi kesalahan di server." });
  }
};

const getSizeDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await priceProposalService.getSizeDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const details = await priceProposalService.getProposalDetails(nomor);
    res.json(details);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getStatusHistory = async (req, res) => {
  try {
    const { nomor } = req.params;
    const history = await priceProposalService.getStatusHistory(nomor);
    res.json(history);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getStatusesBulk = async (req, res) => {
  try {
    const nomors = (req.query.nomors || "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);

    if (nomors.length === 0) {
      return res.json({});
    }

    const statuses = await priceProposalService.getStatusesForNomors(nomors);
    res.json(statuses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Helper generic buat 4 endpoint approve/reject di bawah
const handleStatusAction = (serviceFn, actionLabel) => async (req, res) => {
  try {
    const { nomor } = req.params;
    const { keterangan } = req.body;
    const user = req.user?.username || "UNKNOWN";

    const oldData = await priceProposalService
      .getProposalDetails(nomor)
      .catch(() => null);

    const result = await serviceFn(nomor, user, keterangan);

    auditService.logActivity(
      req,
      "UPDATE_STATUS",
      "PENGAJUAN_HARGA",
      nomor,
      oldData ? { ph_status: result.statusFrom } : null,
      { ph_status: result.statusTo },
      `${actionLabel} pengajuan harga ${nomor}${keterangan ? ` - ${keterangan}` : ""}`,
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const approveCustomer = handleStatusAction(
  priceProposalService.approveCustomer,
  "Acc Customer",
);
const approveFinance = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await priceProposalFormService.approveFinance(
      nomor,
      req.user,
    );

    auditService.logActivity(
      req,
      "UPDATE_STATUS",
      "PENGAJUAN_HARGA",
      nomor,
      { ph_status: result.statusFrom },
      { ph_status: result.statusTo, finalKode: result.finalKode },
      `Acc Finance pengajuan harga ${nomor}${result.finalKode ? ` - Kode Final: ${result.finalKode}` : ""}`,
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
const approveDc = handleStatusAction(priceProposalService.approveDc, "Acc DC");
const reject = handleStatusAction(
  priceProposalService.rejectProposal,
  "Reject",
);
// [BARU] Close manual — beda dari handleStatusAction generic karena butuh
// authNomor (hasil otorisasi SPV), bukan cuma keterangan.
const closeProposal = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { keterangan, authNomor } = req.body;
    const user = req.user?.username || "UNKNOWN";

    if (!authNomor) {
      return res.status(400).json({
        message: "Otorisasi diperlukan untuk menutup pengajuan harga.",
      });
    }

    const oldData = await priceProposalService
      .getProposalDetails(nomor)
      .catch(() => null);

    const result = await priceProposalService.closeProposal(
      nomor,
      user,
      keterangan,
      authNomor,
    );

    auditService.logActivity(
      req,
      "UPDATE_STATUS",
      "PENGAJUAN_HARGA",
      nomor,
      oldData ? { ph_status: result.statusFrom } : null,
      { ph_status: result.statusTo },
      `Close pengajuan harga ${nomor} (Otorisasi: ${authNomor})${keterangan ? ` - ${keterangan}` : ""}`,
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const markReadyStore = handleStatusAction(
  priceProposalService.markReadyStore,
  "Ready di Store",
);

const remove = async (req, res) => {
  try {
    const { nomor } = req.params;

    let oldData = null;
    try {
      const [headerRows] = await pool.query(
        "SELECT * FROM tpengajuanharga WHERE ph_nomor = ?",
        [nomor],
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];
        const [bordirRows] = await pool.query(
          "SELECT * FROM tpengajuanharga_bordir WHERE phb_nomor = ?",
          [nomor],
        );
        const [dtfRows] = await pool.query(
          "SELECT * FROM tpengajuanharga_dtf WHERE phd_nomor = ?",
          [nomor],
        );
        const [sizeRows] = await pool.query(
          "SELECT * FROM tpengajuanharga_size WHERE phs_nomor = ?",
          [nomor],
        );
        const [tambahanRows] = await pool.query(
          "SELECT * FROM tpengajuanharga_tambahan WHERE pht_nomor = ?",
          [nomor],
        );

        oldData = {
          ...header,
          bordir: bordirRows,
          dtf: dtfRows,
          sizes: sizeRows,
          tambahan: tambahanRows,
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData remove price proposal:", e.message);
    }

    const result = await priceProposalService.deleteProposal(nomor);

    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE",
        "PENGAJUAN_HARGA",
        nomor,
        oldData,
        null,
        `Menghapus Pengajuan Harga Customer: ${oldData.ph_kd_cus || "Unknown"}`,
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getSoEligibility = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await priceProposalSoService.checkSoEligibility(nomor);
    res.json(data);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getSoPrefill = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await priceProposalSoService.getSoPrefill(nomor);
    res.json(data);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getDatelineRange = async (req, res) => {
  try {
    const { kepentingan, joKode } = req.query;
    if (!kepentingan || !joKode) {
      return res
        .status(400)
        .json({ message: "kepentingan dan joKode diperlukan." });
    }
    const data = await priceProposalSoService.getDatelineRange(
      kepentingan,
      joKode,
    );
    res.json(data);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const generateSalesOrder = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await priceProposalSoService.generateSalesOrder(
      nomor,
      req.body,
      req.user,
    );

    auditService.logActivity(
      req,
      "GENERATE_SO",
      "PENGAJUAN_HARGA",
      nomor,
      null,
      { soNomor: result.soNomor },
      `Generate SO MANKSI dari Pengajuan Harga ${nomor}: ${result.soNomor}`,
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getSalesOrderForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await priceProposalSoService.getSalesOrderForEdit(
      nomor,
      req.user,
    );
    res.json(data);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const requestSoRevision = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { keterangan } = req.body;
    const result = await priceProposalSoService.requestRevisionFromDc(
      nomor,
      keterangan,
      req.user,
    );

    auditService.logActivity(
      req,
      "REQUEST_REVISI_SO",
      "PENGAJUAN_HARGA",
      nomor,
      null,
      { keterangan },
      `DC meminta revisi SO untuk PH ${nomor}: ${keterangan}`,
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const updateSalesOrder = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await priceProposalSoService.updateSalesOrder(
      nomor,
      req.body,
      req.user,
    );

    auditService.logActivity(
      req,
      "UPDATE_SO_MANKSI",
      "PENGAJUAN_HARGA",
      nomor,
      null,
      { soNomor: result.soNomor, payload: req.body },
      `Update SO MANKSI ${result.soNomor} dari Pengajuan Harga ${nomor}`,
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getAll,
  getSizeDetails,
  getDetails,
  getStatusHistory,
  getStatusesBulk,
  approveCustomer,
  approveFinance,
  approveDc,
  reject,
  closeProposal,
  markReadyStore,
  getSoEligibility,
  getSoPrefill,
  getDatelineRange,
  generateSalesOrder,
  remove,
  getSalesOrderForEdit,
  requestSoRevision,
  updateSalesOrder,
};
