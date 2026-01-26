const mintaBarangFormService = require("../services/mintaBarangFormService");

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
      req.user,
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

/**
 * [CLEANUP] Fungsi Save tanpa Audit Trail dan Snapshot Database.
 */
const save = async (req, res) => {
  try {
    const payload = req.body;

    // Langsung eksekusi proses simpan ke database melalui service
    const result = await mintaBarangFormService.save(payload, req.user);

    // Memberikan response sesuai status (201 untuk baru, 200 untuk update)
    res.status(payload.isNew ? 201 : 200).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getProductDetails = async (req, res) => {
  try {
    const data = await mintaBarangFormService.getProductDetailsForGrid(
      req.query,
      req.user,
    );
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
