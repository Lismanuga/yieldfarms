import * as fs from 'fs';
import * as path from 'path';

// Config for swap limit (can be imported or set here)
export const APR = 0.08; // 8% annual yield
export const FEE = 0.0001; // fee per swap
export const P = 0.5; // portfolio share swapped at once

// Function to calculate the maximum number of swaps per day
export function getMaxSwapsPerDay(apr: number, fee: number, p: number): number {
  return Math.floor((apr / 365) / (p * fee));
}

// State file for daily swap limit
const swapLimitStateFile = path.join(__dirname, 'swap_limit_state.json');

// Read or initialize swap limit state
export function readSwapLimitState() {
  if (!fs.existsSync(swapLimitStateFile)) {
    return {
      lastReset: Date.now(),
      swapsToday: 0,
      maxSwaps: getMaxSwapsPerDay(APR, FEE, P)
    };
  }
  try {
    return JSON.parse(fs.readFileSync(swapLimitStateFile, 'utf-8'));
  } catch {
    return {
      lastReset: Date.now(),
      swapsToday: 0,
      maxSwaps: getMaxSwapsPerDay(APR, FEE, P)
    };
  }
}

function writeSwapLimitState(state: { lastReset: number, swapsToday: number, maxSwaps: number }) {
  fs.writeFileSync(swapLimitStateFile, JSON.stringify(state));
}

// Check and update swap limit state if needed
export function updateSwapLimitStateIfNeeded(logToFile?: (msg: string) => void) {
  const state = readSwapLimitState();
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (now - state.lastReset > oneDayMs) {
    // Recalculate maxSwaps and reset counter
    state.maxSwaps = getMaxSwapsPerDay(APR, FEE, P);
    state.swapsToday = 0;
    state.lastReset = now;
    writeSwapLimitState(state);
    if (logToFile) logToFile(`Swap limit reset: maxSwaps=${state.maxSwaps}, swapsToday=0`);
  }
  return state;
}

export function incrementSwapsToday() {
  const state = readSwapLimitState();
  state.swapsToday++;
  writeSwapLimitState(state);
} 