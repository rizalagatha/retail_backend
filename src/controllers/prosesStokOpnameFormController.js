const service = require("../services/prosesStokOpnameFormService");

const getInitialData = async (req, res) => {
  try {
    const data = await service.getInitialData(req.user);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    // Mode Create
    const result = await service.saveData(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message }); // Gunakan 400 untuk error validasi
  }
};

const getDataForEdit = async (req, res) => {
  try {
    const { id } = req.params;
    const data = await service.getDataForEdit(id);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const updateData = async (req, res) => {
  try {
    const payload = {
      ...req.body,
      header: { ...req.body.header, nomor: req.params.id },
    };
    const result = await service.saveData(payload, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getProductDetails = async (req, res) => {
    try {
        const { barcode } = req.params;
        const { cabang, tanggalSop } = req.query;
        const data = await service.getProductDetailsForSop(barcode, cabang, tanggalSop);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const getDataFromStaging = async (req, res) => {
    try {
        const data = await service.getDataFromStaging(req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
  getInitialData,
  saveData,
  getDataForEdit,
  updateData,
  getProductDetails,
  getDataFromStaging,
};
