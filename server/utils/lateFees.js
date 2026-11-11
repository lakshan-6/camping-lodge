const HOUR_MS = 3600000;

export function lateFeeInfo(rental, lines, graceMinutes = 0, now = Date.now()) {
  const lateMs = Math.max(0, now - +new Date(rental.dueDate) - graceMinutes * 60000);
  const percent = lateMs > 12 * HOUR_MS ? 100 : Math.floor(lateMs / (2 * HOUR_MS)) * 10;
  // An older return settled the late charge for this deadline under the previous policy.
  const previouslyCharged = rental.lateFeePercentCharged ?? (rental.latePeriodsCharged > 0 ? 100 : 0);
  const chargedPercent = Math.max(percent, previouslyCharged);
  const additionalPercent = chargedPercent - previouslyCharged;
  const feeCents = lines.reduce((sum, { remaining, periodRate }) => {
    const rateCents = Math.round(periodRate * 100);
    const before = Math.round(rateCents * previouslyCharged / 100);
    const after = Math.round(rateCents * chargedPercent / 100);
    return sum + remaining * (after - before);
  }, 0);
  return { lateFee: feeCents / 100, chargedPercent, additionalPercent };
}
