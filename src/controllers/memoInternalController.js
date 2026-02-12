const service = require("../services/memoInternalService");

const getList = async (req, res) => {
  try {
    const data = await service.getAllMemos();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const handleUpload = async (req, res) => {
  try {
    if (!req.file) throw new Error("File PDF wajib diunggah.");

    const result = await service.uploadMemo(
      req.body.title,
      req.file.path,
      req.file.filename,
      req.user,
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = { getList, handleUpload };
