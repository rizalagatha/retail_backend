const service = require("../services/returJualFormService");

const loadFromInvoice = async (req, res) => {
  try {
    const data = await service.loadFromInvoice(req.params.nomorInvoice);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getForEdit = async (req, res) => {
  try {
    const data = await service.getForEdit(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await service.save(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const lookupInvoices = async (req, res) => {
  try {
    const data = await service.lookupInvoices(req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const findByBarcode = async (req, res) => {
    try {
        const data = await service.findByBarcode(req.params.barcode);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const getPrintData = async (req, res) => {
    try {
        const data = await service.getPrintData(req.params.nomor);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

module.exports = {
  loadFromInvoice,
  getForEdit,
  save,
  lookupInvoices,
  findByBarcode,
  getPrintData,
};
