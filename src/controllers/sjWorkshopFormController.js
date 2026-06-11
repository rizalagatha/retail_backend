const sjWorkshopFormService = require("../services/sjWorkshopFormService");
const { searchSo } = require("./invoiceFormController");

const save = async (req, res) => {
  try {
    const payload = req.body;
    const result = await sjWorkshopFormService.saveData(payload, req.user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const loadForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await sjWorkshopFormService.loadForEdit(nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    const { gudang } = req.query;
    if (!gudang)
      return res.status(400).json({ message: "Parameter gudang diperlukan." });

    const product = await sjWorkshopFormService.findByBarcode(barcode, gudang);
    res.json(product);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const searchSoBordirSelesai = async (req, res) => {
  try {
    const { term, page = 1, itemsPerPage = 10 } = req.query;
    const data = await sjWorkshopFormService.searchSoBordirSelesai(
      term,
      page,
      itemsPerPage,
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getItemsFromSo = async (req, res) => {
  try {
    const { soNomor, gudang } = req.query;
    if (!soNomor)
      return res.status(400).json({ message: "soNomor diperlukan." });
    if (!gudang) return res.status(400).json({ message: "gudang diperlukan." });

    const data = await sjWorkshopFormService.getItemsFromSo(soNomor, gudang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await sjWorkshopFormService.getPrintData(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

module.exports = {
  save,
  loadForEdit,
  getByBarcode,
  searchSoBordirSelesai,
  getItemsFromSo,
  getPrintData,
};
