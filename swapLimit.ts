// Config for swap limit (can be imported or set here)
export const APR = 0.08; // 8% annual yield
export const FEE = 0.0001; // fee per swap

// In-memory state
let maxSwaps: number = 0;
let swapsToday: number = 0;
let lastReset: number = Date.now();

// Function to calculate the maximum number of swaps per day (now takes P as argument)
export function getMaxSwapsPerDay(apr: number, fee: number, p: number): number {
  return Math.floor((apr / 365) / (p * fee));
}

/**
 * Calculate dynamic P (swap share) for a bin.
 * @param bins - array of bin objects (from fetchMerchantMoeBins)
 * @param tokenX - symbol or address of token X (e.g. 'USDC')
 * @param tokenY - symbol or address of token Y (e.g. 'USDT')
 * @returns P = Rx / (Rx + Ry) for the active bin
 */
export function getDynamicP(bins: any[], tokenX: string, tokenY: string): number {
  let bestBin = null;
  let maxLiquidity = 0;
  for (const bin of bins) {
    const Rx = Number(bin.reserveX);
    const Ry = Number(bin.reserveY);
    if (Rx + Ry > maxLiquidity) {
      maxLiquidity = Rx + Ry;
      bestBin = bin;
    }
  }
  if (!bestBin) throw new Error('No bin found for dynamic P calculation');
  const Rx = Number(bestBin.reserveX);
  const Ry = Number(bestBin.reserveY);
  if (Rx + Ry === 0) return 0;
  return Rx / (Rx + Ry);
}

// Call this to update maxSwaps for the day (after getting fresh P)
export function setMaxSwapsForToday(p: number) {
  maxSwaps = getMaxSwapsPerDay(APR, FEE, p);
  swapsToday = 0;
  lastReset = Date.now();
}

// Call this at the start of each loop to check if 24h passed and reset if needed
export function checkAndResetSwapLimitIfNeeded(p: number) {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (now - lastReset > oneDayMs) {
    setMaxSwapsForToday(p);
  }
}

export function incrementSwapsToday() {
  swapsToday++;
}

export function getMaxSwaps() {
  return maxSwaps;
}

export function getSwapsToday() {
  return swapsToday;
} 