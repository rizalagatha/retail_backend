const dashboardService = require("./dashboardService");
const { format, subDays, addDays } = require("date-fns");

// Forecasting sederhana berbasis 2 komponen:
// 1. TREND — linear regression dari data harian historis (nangkep arah naik/turun)
// 2. SEASONALITY HARI-DALAM-MINGGU — rata-rata rasio tiap hari (Senin..Minggu)
//    terhadap rata-rata keseluruhan, karena retail biasanya weekend lebih rame
//
// SENGAJA statistik sederhana (bukan ARIMA/Prophet) — cukup akurat untuk
// proyeksi jangka pendek (7-30 hari), dan jauh lebih murah/cepat dibanding
// setup microservice Python terpisah. Kalau nanti kebutuhan forecasting-nya
// makin kompleks (musiman tahunan, event khusus), baru worth upgrade ke
// library time-series proper.

const MIN_HISTORY_DAYS = 14; // di bawah ini, forecast dianggap terlalu tidak reliable
const RECOMMENDED_HISTORY_DAYS = 28; // idealnya >=4 minggu, biar pola weekday kebaca penuh
const HISTORY_WINDOW_DAYS = 60; // seberapa jauh ke belakang data historis diambil

const linearRegression = (values) => {
  const n = values.length;
  const xs = values.map((_, i) => i);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((acc, x, i) => acc + x * values[i], 0);
  const sumXX = xs.reduce((acc, x) => acc + x * x, 0);

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
};

const getWeekdayMultipliers = (dailyData) => {
  // dailyData: [{ tanggal: 'yyyy-mm-dd', total: number }, ...]
  const sums = [0, 0, 0, 0, 0, 0, 0]; // Minggu=0 .. Sabtu=6 (sesuai Date.getDay())
  const counts = [0, 0, 0, 0, 0, 0, 0];

  dailyData.forEach((row) => {
    const day = new Date(row.tanggal).getDay();
    sums[day] += Number(row.total) || 0;
    counts[day] += 1;
  });

  const overallAvg =
    dailyData.reduce((acc, r) => acc + (Number(r.total) || 0), 0) /
    (dailyData.length || 1);

  if (overallAvg === 0) return [1, 1, 1, 1, 1, 1, 1];

  return sums.map((sum, i) => {
    if (counts[i] === 0) return 1; // gak ada data hari itu, netral
    const avgForDay = sum / counts[i];
    return avgForDay / overallAvg;
  });
};

const forecastSales = async (user, { cabang = null, horizonDays = 7 } = {}) => {
  const safeHorizon = Math.min(30, Math.max(1, Number(horizonDays) || 7));

  const endDate = format(subDays(new Date(), 1), "yyyy-MM-dd"); // sampai kemarin (hari ini belum penuh)
  const startDate = format(
    subDays(new Date(), HISTORY_WINDOW_DAYS),
    "yyyy-MM-dd",
  );

  const dailyData = await dashboardService.getSalesChartData(
    { startDate, endDate, cabang: cabang || "ALL", groupBy: "day" },
    user,
  );

  if (dailyData.length < MIN_HISTORY_DAYS) {
    return {
      insufficient: true,
      message: `Data historis cuma ${dailyData.length} hari, minimal butuh ${MIN_HISTORY_DAYS} hari untuk membuat proyeksi yang layak.`,
    };
  }

  const values = dailyData.map((r) => Number(r.total) || 0);
  const { slope, intercept } = linearRegression(values);
  const weekdayMultipliers = getWeekdayMultipliers(dailyData);

  // Residual (selisih aktual vs trend*seasonality) buat estimasi confidence range
  const residuals = values.map((v, i) => {
    const day = new Date(dailyData[i].tanggal).getDay();
    const predicted = (slope * i + intercept) * weekdayMultipliers[day];
    return v - predicted;
  });
  const meanResidual = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const variance =
    residuals.reduce((acc, r) => acc + Math.pow(r - meanResidual, 2), 0) /
    residuals.length;
  const stdDev = Math.sqrt(variance);

  const forecast = [];
  for (let i = 1; i <= safeHorizon; i++) {
    const futureIndex = values.length - 1 + i;
    const futureDate = addDays(
      new Date(dailyData[dailyData.length - 1].tanggal),
      i,
    );
    const day = futureDate.getDay();
    const baseTrend = slope * futureIndex + intercept;
    const predicted = Math.max(0, baseTrend * weekdayMultipliers[day]);

    forecast.push({
      tanggal: format(futureDate, "yyyy-MM-dd"),
      prediksi: Math.round(predicted),
      rangeBawah: Math.round(Math.max(0, predicted - stdDev)),
      rangeAtas: Math.round(predicted + stdDev),
    });
  }

  const totalForecast = forecast.reduce((acc, f) => acc + f.prediksi, 0);
  const trendDirection =
    slope > 0.5 ? "naik" : slope < -0.5 ? "turun" : "stabil";

  return {
    insufficient: false,
    historyDaysUsed: dailyData.length,
    reliabilityNote:
      dailyData.length < RECOMMENDED_HISTORY_DAYS
        ? `Catatan: data historis cuma ${dailyData.length} hari (idealnya minimal ${RECOMMENDED_HISTORY_DAYS} hari / 4 minggu supaya pola per hari dalam seminggu lebih akurat) — anggap proyeksi ini sebagai perkiraan kasar.`
        : null,
    trendDirection,
    totalForecast,
    forecast,
    disclaimer:
      "Ini proyeksi statistik berdasarkan tren dan pola hari dalam seminggu dari data historis, BUKAN jaminan — event khusus, promo, atau perubahan mendadak tidak tercermin di sini.",
  };
};

module.exports = { forecastSales };
