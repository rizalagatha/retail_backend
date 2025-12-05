// src/controllers/userActivityController.js
const userActivityService = require("../services/userActivityService");

const logMenu = async (req, res) => {
  try {
    // Pastikan middleware auth sudah berjalan dan mengisi req.user
    const userKode = req.user.kode;
    const { title, path, icon } = req.body;

    await userActivityService.logMenuAccess(userKode, { title, path, icon });

    res.status(200).json({ message: "Activity logged" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to log activity" });
  }
};

const getFrequentMenus = async (req, res) => {
  try {
    const userKode = req.user.kode;
    const menus = await userActivityService.getFrequentMenus(userKode);

    res.status(200).json(menus);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch menus" });
  }
};

module.exports = {
  logMenu,
  getFrequentMenus,
};
