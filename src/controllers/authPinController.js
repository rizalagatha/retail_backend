const authPinService = require('../services/authPinService');

const validate = async (req, res) => {
    try {
        const { code, pin } = req.body;

        if (!code || !pin) {
            return res.status(400).json({ message: 'Kode dan PIN diperlukan.' });
        }

        const result = await authPinService.validatePin(code, pin);
        res.json(result);

    } catch (error) {
        // Mengirim status 401 (Unauthorized) jika validasi gagal
        res.status(401).json({ message: error.message });
    }
};

module.exports = {
    validate,
};
