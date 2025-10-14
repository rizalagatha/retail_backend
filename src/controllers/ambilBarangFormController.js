const service = require("../services/ambilBarangFormService");

const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const data = await service.getDataForEdit(id);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const saveNew = async (req, res) => {
  try {
    const result = await service.saveData(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateExisting = async (req, res) => {
  try {
    const payload = {
      header: { ...req.body.header, nomor: req.params.id },
      items: req.body.items,
    };
    const result = await service.saveData(payload, req.user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const lookupProductByBarcode = async (req, res) => {
  try {
    const { barcode, gudang } = req.query;
    if (!barcode || !gudang) {
      return res
        .status(400)
        .json({ message: "Parameter 'barcode' dan 'gudang' diperlukan." });
    }
    const data = await service.lookupProductByBarcode(barcode, gudang);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

module.exports = {
  getById,
  saveNew,
  updateExisting,
  lookupProductByBarcode,
};
