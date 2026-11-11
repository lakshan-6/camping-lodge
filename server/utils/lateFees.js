const HOUR_MS = 3600000;

const DEFAULT_LATE_FEE = {
  lateFeeIntervalHours: 2,
  lateFeeStepPercent: 10,
  lateFeeFullRateAfterHours: 12,
};

export function lateFeePolicy(settings = {}) {
  return {
    lateFeeIntervalHours: settings.lateFeeIntervalHours ?? DEFAULT_LATE_FEE.lateFeeIntervalHours,
    lateFeeStepPercent: settings.lateFeeStepPercent ?? DEFAULT_LATE_FEE.lateFeeStepPercent,
    lateFeeFullRateAfterHours: settings.lateFeeFullRateAfterHours ?? DEFAULT_LATE_FEE.lateFeeFullRateAfterHours,
  };
}

export function lateFeeInfo(rental, lines, settings = {}, now = Date.now()) {
  const { lateFeeIntervalHours, lateFeeStepPercent, lateFeeFullRateAfterHours } = lateFeePolicy(settings);
  const lateMs = Math.max(0, now - +new Date(rental.dueDate) - (settings.graceMinutes || 0) * 60000);
  const steps = Math.floor(lateMs / Math.round(lateFeeIntervalHours * HOUR_MS));
  const percent = lateMs > Math.round(lateFeeFullRateAfterHours * HOUR_MS)
    ? 100 : Math.min(10000, steps * Math.round(lateFeeStepPercent * 100)) / 100;
  // An older return settled the late charge for this deadline under the previous policy.
  const previouslyCharged = rental.lateFeePercentCharged ?? (rental.latePeriodsCharged > 0 ? 100 : 0);
  const chargedPercent = Math.max(percent, previouslyCharged);
  const additionalPercent = Math.round((chargedPercent - previouslyCharged) * 100) / 100;
  const previousBasisPoints = Math.round(previouslyCharged * 100);
  const chargedBasisPoints = Math.round(chargedPercent * 100);
  const feeCents = lines.reduce((sum, { remaining, periodRate }) => {
    const rateCents = Math.round(periodRate * 100);
    const before = Math.round(rateCents * previousBasisPoints / 10000);
    const after = Math.round(rateCents * chargedBasisPoints / 10000);
    return sum + remaining * (after - before);
  }, 0);
  return { lateFee: feeCents / 100, chargedPercent, additionalPercent };
}
