const pettyCashFormService = require("../services/pettyCashFormService");
const pool = require("../config/database");
const pettyCashService = require("../services/pettyCashService");

const saveData = async (req, res) => {
  try {
    // req.body berisi JSON string, req.files berisi array file hasil upload Multer
    const result = await pettyCashFormService.saveData(
      req.body,
      req.files,
      req.user,
    );
    res.json(result);
  } catch (error) {
    console.error("Error save Petty Cash:", error);
    res.status(500).json({ message: error.message || "Gagal menyimpan data." });
  }
};

const getDetailKlaimFinance = async (req, res) => {
  try {
    const { pck_nomor } = req.params;
    // Panggil fungsi getDetailKlaimFinance dari pettyCashService
    const data = await pettyCashService.getDetailKlaimFinance(pck_nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await pettyCashFormService.getDetail(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const approve = async (req, res) => {
  try {
    const result = await pettyCashFormService.approveClaim(
      req.params.nomor,
      req.user.kode,
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const reject = async (req, res) => {
  try {
    const { alasan } = req.body;
    if (!alasan)
      return res.status(400).json({ message: "Alasan penolakan wajib diisi." });
    const result = await pettyCashFormService.rejectClaim(
      req.params.nomor,
      req.user.kode,
      alasan,
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const data = await pettyCashFormService.getPrintData(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getSaldoStore = async (req, res) => {
  try {
    // [PERBAIKAN] Langsung gunakan pettyCashService yang sudah kita buat pinter
    // Parameter ke-2 (excludeNomor) diisi null, parameter ke-3 (conn) dikosongkan agar pakai pool default
    const saldo = await pettyCashFormService.getCurrentSaldo(
      req.user.cabang,
      null,
    );

    res.json({ saldo });
  } catch (error) {
    console.error("Error getSaldoStore:", error);
    res
      .status(400)
      .json({ message: error.message || "Gagal mengambil saldo." });
  }
};

module.exports = {
  saveData,
  getDetailKlaimFinance,
  getDetail,
  approve,
  reject,
  getPrintData,
  getSaldoStore,
};
