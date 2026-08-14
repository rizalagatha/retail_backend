const manifestKirimService = require("../services/manifestKirimService");
const auditService = require("../services/auditService");
const pool = require("../config/database");

const getList = async (req, res) => {
  try {
    const data = await manifestKirimService.getList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await manifestKirimService.getDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getAvailableSj = async (req, res) => {
  try {
    const { gudang, store } = req.query;
    const data = await manifestKirimService.getAvailableSj(gudang, store);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const user = req.user || { id: "ADMIN", kode: "ADMIN" };
    const { isNew } = req.body;
    const targetNomor = req.body.header?.nomor || "BARU";

    // Snapshot data lama jika Edit
    let oldData = null;
    if (!isNew && targetNomor !== "BARU") {
      try {
        oldData = await manifestKirimService.getDetails(targetNomor);
      } catch (e) {
        console.warn("Gagal snapshot oldData Manifest Kirim:", e.message);
      }
    }

    const result = await manifestKirimService.saveData(req.body, user);

    // Catat Audit Trail
    auditService.logActivity(
      req,
      isNew ? "CREATE" : "UPDATE",
      "MANIFEST_KIRIM",
      result.nomor,
      oldData,
      req.body,
      isNew
        ? `Membuat Manifest Kirim Baru: ${result.nomor}`
        : `Mengubah Manifest Kirim: ${result.nomor}`
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const { nomor } = req.params;

    // Snapshot data lama sebelum dihapus
    let oldData = null;
    try {
      oldData = await manifestKirimService.getDetails(nomor);
    } catch (e) {
      console.warn("Gagal snapshot oldData remove Manifest Kirim:", e.message);
    }

    const result = await manifestKirimService.remove(nomor);

    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE",
        "MANIFEST_KIRIM",
        nomor,
        oldData,
        null,
        `Menghapus Manifest Kirim: ${nomor}`
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getList,
  getDetails,
  getAvailableSj,
  saveData,
  remove,
};
