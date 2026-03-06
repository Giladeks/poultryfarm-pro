// lib/services/analytics.js — Core analytics & KPI calculations

/**
 * Calculates Feed Conversion Ratio (FCR) for a flock.
 * FCR = total feed consumed (kg) / total weight gained (kg)
 */
export function calculateFCR(totalFeedKg, totalBirds, avgWeightGainG) {
  const totalWeightKg = (totalBirds * avgWeightGainG) / 1000;
  if (totalWeightKg === 0) return null;
  return parseFloat((totalFeedKg / totalWeightKg).toFixed(2));
}

/**
 * Calculates laying rate percentage.
 * layingRate = (eggs collected / current bird count) * 100
 */
export function calculateLayingRate(eggsCollected, currentBirdCount) {
  if (currentBirdCount === 0) return 0;
  return parseFloat(((eggsCollected / currentBirdCount) * 100).toFixed(2));
}

/**
 * Calculates mortality rate percentage for a period.
 */
export function calculateMortalityRate(deaths, startCount) {
  if (startCount === 0) return 0;
  return parseFloat(((deaths / startCount) * 100).toFixed(3));
}

/**
 * Calculates cost per egg produced.
 */
export function calculateCostPerEgg(totalFeedCost, totalLaborCost, totalMedCost, totalEggsProduced) {
  if (totalEggsProduced === 0) return null;
  const totalCost = totalFeedCost + totalLaborCost + totalMedCost;
  return parseFloat((totalCost / totalEggsProduced).toFixed(4));
}

/**
 * Calculates cost per kg of broiler weight.
 */
export function calculateCostPerKg(totalCost, totalWeightKg) {
  if (totalWeightKg === 0) return null;
  return parseFloat((totalCost / totalWeightKg).toFixed(2));
}

/**
 * Generates a 90-day revenue forecast based on current flock data.
 * Uses simple linear projection with seasonal adjustment factor.
 */
export function generateRevenueForecast(flocks, historicalEggs, avgEggPrice, avgBroilerPrice) {
  const layerFlocks = flocks.filter(f => f.birdType === 'LAYER' && f.status === 'ACTIVE');
  const broilerFlocks = flocks.filter(f => f.birdType === 'BROILER' && f.status === 'ACTIVE');

  const forecast = [];
  const today = new Date();

  for (let month = 1; month <= 3; month++) {
    const forecastDate = new Date(today);
    forecastDate.setMonth(forecastDate.getMonth() + month);

    // Layer revenue: estimated eggs per month at current laying rate
    const layerBirds = layerFlocks.reduce((sum, f) => sum + f.currentCount, 0);
    const avgLayingRate = historicalEggs.length > 0
      ? historicalEggs.slice(-7).reduce((s, e) => s + e.layingRatePct, 0) / Math.min(7, historicalEggs.length)
      : 82;
    const monthlyEggs = layerBirds * (avgLayingRate / 100) * 30;
    const layerRevenue = monthlyEggs * avgEggPrice;

    // Broiler revenue: birds expected to harvest in this month
    const harvestingBroilers = broilerFlocks
      .filter(f => {
        if (!f.expectedHarvestDate) return false;
        const h = new Date(f.expectedHarvestDate);
        return h.getMonth() === forecastDate.getMonth() && h.getFullYear() === forecastDate.getFullYear();
      })
      .reduce((sum, f) => sum + f.currentCount, 0);
    const broilerRevenue = harvestingBroilers * 2.3 * avgBroilerPrice; // avg 2.3kg live weight

    const confidence = Math.max(40, 90 - (month - 1) * 15);

    forecast.push({
      month: forecastDate.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' }),
      layerRevenue: parseFloat(layerRevenue.toFixed(2)),
      broilerRevenue: parseFloat(broilerRevenue.toFixed(2)),
      totalRevenue: parseFloat((layerRevenue + broilerRevenue).toFixed(2)),
      confidence,
    });
  }

  return forecast;
}

/**
 * Detects anomalies in a time series (e.g. mortality spikes).
 * Uses simple z-score method.
 */
export function detectAnomalies(series, zThreshold = 2.0) {
  if (series.length < 5) return [];

  const values = series.map(s => s.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length);

  if (std === 0) return [];

  return series
    .map((s, i) => ({ ...s, zScore: (s.value - mean) / std, index: i }))
    .filter(s => Math.abs(s.zScore) > zThreshold);
}

/**
 * Estimates optimal harvest date for broilers based on FCR and target weight.
 * Simple model: days to reach target = (targetWeight - currentWeight) / dailyGainG
 */
export function predictOptimalHarvestDate(currentAvgWeightG, targetWeightG, dailyGainG = 55) {
  if (currentAvgWeightG >= targetWeightG) return new Date();
  const daysNeeded = Math.ceil((targetWeightG - currentAvgWeightG) / dailyGainG);
  const harvestDate = new Date();
  harvestDate.setDate(harvestDate.getDate() + daysNeeded);
  return harvestDate;
}

/**
 * Aggregates daily production into weekly/monthly summaries.
 */
export function aggregateProduction(records, groupBy = 'week') {
  const groups = {};

  for (const record of records) {
    const date = new Date(record.collectionDate);
    let key;

    if (groupBy === 'week') {
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      key = weekStart.toISOString().split('T')[0];
    } else if (groupBy === 'month') {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    } else {
      key = date.toISOString().split('T')[0];
    }

    if (!groups[key]) {
      groups[key] = { period: key, totalEggs: 0, gradeA: 0, gradeB: 0, cracked: 0, days: 0 };
    }

    groups[key].totalEggs += record.totalEggs;
    groups[key].gradeA += record.gradeACount;
    groups[key].gradeB += record.gradeBCount;
    groups[key].cracked += record.crackedCount;
    groups[key].days += 1;
  }

  return Object.values(groups).map(g => ({
    ...g,
    avgDailyEggs: Math.round(g.totalEggs / g.days),
    gradeAPercent: parseFloat(((g.gradeA / g.totalEggs) * 100).toFixed(1)),
  }));
}
