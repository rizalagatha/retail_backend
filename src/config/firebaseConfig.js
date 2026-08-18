const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const serviceAccountPath = path.join(__dirname, "service-account.json");

const apps = admin.apps || (admin.default && admin.default.apps) || [];

if (!apps.length) {
    if (fs.existsSync(serviceAccountPath)) {
        try {
            const serviceAccount = require("./service-account.json");
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
            console.log("🔥 [FIREBASE] Berhasil diinisialisasi.");
        } catch (err) {
            console.warn(
                "⚠️ [FIREBASE] Gagal menginisialisasi Firebase:",
                err.message,
            );
        }
    } else {
        console.warn(
            "⚠️ [FIREBASE] File service-account.json tidak ditemukan. Fitur Push Notification dinonaktifkan di lokal.",
        );
    }
}

module.exports = admin;
