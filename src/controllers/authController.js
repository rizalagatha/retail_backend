const authService = require('../services/authService');

const login = async (req, res) => {
    try {
        const { kodeUser, password } = req.body;
        const result = await authService.loginUser(kodeUser, password);
        res.json(result);
    } catch (error) {
        res.status(401).json({ message: error.message }); // 401 Unauthorized
    }
};

module.exports = { login };