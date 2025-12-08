// backend/src/controllers/healthController.js

const checkHealth = async (req, res) => {
    // Tidak perlu query DB, cukup return 200 OK
    // Ini membuat respon sangat cepat (< 10ms) untuk mengukur latency jaringan
    res.status(200).json({ 
        status: 'ok', 
        message: 'Server is running', 
        timestamp: new Date() 
    });
};

module.exports = { checkHealth };