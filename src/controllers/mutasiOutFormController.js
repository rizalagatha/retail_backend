const mutasiOutFormService = require("../services/mutasiOutFormService");

const loadForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await mutasiOutFormService.loadForEdit(nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchSo = async (req, res) => {
  try {
    const data = await mutasiOutFormService.searchSo(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSoDetailsForGrid = async (req, res) => {
  try {
    const { soNomor } = req.params;
    const data = await mutasiOutFormService.getSoDetailsForGrid(
      soNomor,
      req.user,
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * [CLEANUP] Fungsi Save tanpa Audit Trail dan Snapshot Database.
 */
const save = async (req, res) => {
  try {
    const payload = req.body;

    // Langsung eksekusi simpan tanpa snapshot oldData dan logActivity rutin
    const result = await mutasiOutFormService.save(payload, req.user);

    res.status(payload.isNew ? 201 : 200).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await mutasiOutFormService.getPrintData(nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const exportDetails = async (req, res) => {
  try {
    const data = await mutasiOutFormService.getExportDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  loadForEdit,
  searchSo,
  getSoDetailsForGrid,
  save,
  getPrintData,
  exportDetails,
};
