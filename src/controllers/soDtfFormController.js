const soDtfFormService = require('../services/soDtfFormService');

const getById = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await soDtfFormService.findById(nomor);
        if (!data) {
            return res.status(404).json({ message: 'Data tidak ditemukan' });
        }
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const create = async (req, res) => {
    try {
        // user didapat dari middleware verifyToken
        const user = req.user; 
        const newData = await soDtfFormService.create(req.body, user);
        res.status(201).json(newData);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const update = async (req, res) => {
    try {
        const { nomor } = req.params;
        const user = req.user;
        const updatedData = await soDtfFormService.update(nomor, req.body, user);
        res.json({ message: 'Data berhasil diperbarui', data: updatedData });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getById,
    create,
    update,
};

