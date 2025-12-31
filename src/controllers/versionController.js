const versionService = require("../services/versionService");

const checkVersion = async (req, res) => {
  try {
    const latestVersion = await versionService.getLatestVersion();
    if (latestVersion) {
      res.json({ latestVersion });
    } else {
      res.status(404).json({ message: "Informasi versi tidak ditemukan." });
    }
  } catch (error) {
    console.error("Error di checkVersion:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server" });
  }
};

module.exports = { checkVersion };
