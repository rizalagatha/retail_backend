const memberService = require('../services/memberService');

const getAll = async (req, res) => {
    try {
        const members = await memberService.getAllMembers();
        res.json(members);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const save = async (req, res) => {
    try {
        const result = await memberService.saveMember(req.body);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const { hp } = req.params;
        const result = await memberService.deleteMember(hp);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { getAll, save, remove, };