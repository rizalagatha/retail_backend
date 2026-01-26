const service = require("../services/mutasiTerimaFormService");

const loadFromKirim = async (req, res) => {
  try {
    const data = await service.loadFromKirim(req.params.nomorKirim);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

/**
 * [CLEANUP] Fungsi Save tanpa Audit Trail.
 * Berfokus pada eksekusi simpan data untuk performa yang lebih ringan.
 */
const save = async (req, res) => {
  try {
    const payload = req.body;

    // Langsung eksekusi simpan ke database melalui service
    const result = await service.save(payload, req.user);

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { loadFromKirim, save };
