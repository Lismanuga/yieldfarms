import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import LBRouterABI from "./abis/LBRouter.json";
import LBPairABI from "./abis/LBPair.json";
import ERC20ABI from "./abis/ERC20.json";
import { getDynamicP, checkAndResetSwapLimitIfNeeded, getMaxSwaps, getSwapsToday, setMaxSwapsForToday, incrementSwapsToday } from './swapLimit';
import { fetchMerchantMoeBins, fetchDexScreenerData } from './fetch-and-save';
dotenv.config();

const LBRouterAddress = process.env.LB_ROUTER_ADDRESS!;
const PAIR_ADDRESS = process.env.PAIR_ADDRESS!;
const MNT_ADDRESS = process.env.MNT_ADDRESS!;
const userPrivateKey = process.env.PRIVATE_KEY!;

if (!LBRouterAddress || !PAIR_ADDRESS || !MNT_ADDRESS || !userPrivateKey) {
  throw new Error("One or more required environment variables are missing: LB_ROUTER_ADDRESS, PAIR_ADDRESS, MNT_ADDRESS, PRIVATE_KEY");
}

const provider = new ethers.JsonRpcProvider("https://rpc.mantle.xyz");
const wallet = new ethers.Wallet(userPrivateKey, provider);
const router = new ethers.Contract(LBRouterAddress, LBRouterABI, wallet);

// Setup logging
const logFile = path.join(__dirname, "rebalance-logs.txt");

function logToFile(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(logFile, logMessage);
}

async function approveIfNeeded(token: ethers.Contract, amount: bigint, label: string) {
  const allowance = await token.allowance(wallet.address, LBRouterAddress);
  if (allowance < amount) {

    const tx = await token.approve(LBRouterAddress, ethers.MaxUint256);
    await tx.wait();
  } else {
    console.log(`✅ ${label} allowance is sufficient.`);
  }
}

async function checkAndRebalanceLiquidity() {
  
  // Get pair contract and information
  const lbPair = new ethers.Contract(PAIR_ADDRESS, LBPairABI, wallet);
  const tokenX = await lbPair.getTokenX();
  const tokenY = await lbPair.getTokenY();
  const binStep = await lbPair.getBinStep();
  const activeId = Number(await lbPair.getActiveId());
  
  // Check if one of the tokens is MNT
  const isTokenXMNT = tokenX.toLowerCase() === MNT_ADDRESS.toLowerCase();
  const isTokenYMNT = tokenY.toLowerCase() === MNT_ADDRESS.toLowerCase();
  
  // Find all bins with liquidity for the wallet
  const range = 50; // Check a wider range
  const binsToCheck: number[] = [];
  for (let i = activeId - range; i <= activeId + range; i++) {
    binsToCheck.push(i);
  }
  const accounts = Array(binsToCheck.length).fill(wallet.address);
  const balances: bigint[] = await lbPair.balanceOfBatch(accounts, binsToCheck);
  
  // Determine rewardable bins (active ±1)
  const REWARDABLE_BINS = 0;
  const rewardableBins = [activeId - REWARDABLE_BINS, activeId, activeId + REWARDABLE_BINS];
  
  // Count and sum up liquidity
  let totalLiquidity = 0n;
  let activeBinsLiquidity = 0n;
  let nonActiveBinsLiquidity = 0n;
  let activeBinsCount = 0;
  let nonActiveBinsCount = 0;
  
  // Prepare lists for withdrawing liquidity only from non-active bins
  const ids: number[] = [];
  const amounts: bigint[] = [];
  
  balances.forEach((balance: bigint, index: number) => {
    const binId = binsToCheck[index];
    if (balance > 0n) {
      if (rewardableBins.includes(binId)) {
        activeBinsLiquidity += balance;
        activeBinsCount++;
      } else {
        nonActiveBinsLiquidity += balance;
        nonActiveBinsCount++;
        
        // Add to withdrawal lists
        ids.push(binId);
        amounts.push(balance);
      }
      totalLiquidity += balance;
    }
  });

  
  // If no non-active bins, exit
  if (ids.length === 0) {
    console.log("\nNo non-active bins with liquidity to rebalance. Exiting.");
    return;
  }
  
  // Set minimum amounts and deadline
  const amountXMin = 0n;
  const amountYMin = 0n;
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  
  try {
    // Get initial balances
    const tokenXContract = new ethers.Contract(tokenX, ERC20ABI, wallet);
    const tokenYContract = new ethers.Contract(tokenY, ERC20ABI, wallet);
    
    const initialBalanceX = await tokenXContract.balanceOf(wallet.address);
    const initialBalanceY = await tokenYContract.balanceOf(wallet.address);
    
    // Use appropriate remove liquidity method based on MNT presence
    let removeTx;
    if (isTokenXMNT) {
      removeTx = await router.removeLiquidityNATIVE(
        tokenY,
        binStep,
        amountXMin,
        amountYMin,
        ids,
        amounts,
        wallet.address,
        deadline
      );
    } else if (isTokenYMNT) {
      removeTx = await router.removeLiquidityNATIVE(
        tokenX,
        binStep,
        amountXMin,
        amountYMin,
        ids,
        amounts,
        wallet.address,
        deadline
      );
    } else {
      removeTx = await router.removeLiquidity(
        tokenX,
        tokenY,
        binStep,
        amountXMin,
        amountYMin,
        ids,
        amounts,
        wallet.address,
        deadline
      );
    }
    
    console.log("Transaction sent:", removeTx.hash);
    const receipt = await removeTx.wait();
    
    // Log gas usage
    const gasUsed = receipt.gasUsed;
    const gasPrice = receipt.gasPrice;
    const gasCost = gasUsed * gasPrice;
    logToFile(`Rebalance executed - Gas used: ${gasUsed}, Gas cost: ${ethers.formatEther(gasCost)} $, Tx hash: ${receipt.hash}`);
    
    console.log("✅ Liquidity withdrawn. Tx hash:", receipt.hash);
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Get new balances after withdrawal
    const newBalanceX = await tokenXContract.balanceOf(wallet.address);
    const newBalanceY = await tokenYContract.balanceOf(wallet.address);
    
    // Calculate received amounts
    const receivedX = newBalanceX - initialBalanceX;
    const receivedY = newBalanceY - initialBalanceY;
    
    const tokenXDecimals = await tokenXContract.decimals();
    const tokenYDecimals = await tokenYContract.decimals();
    
    // Approve tokens if needed (skip for MNT)
    if (!isTokenXMNT) {
      await approveIfNeeded(tokenXContract, BigInt(receivedX), "TokenX");
    }
    if (!isTokenYMNT) {
      await approveIfNeeded(tokenYContract, BigInt(receivedY), "TokenY");
    }
    
    // Add delay before next transaction
    await new Promise(resolve => setTimeout(resolve,15000));
    
    // Add liquidity to active bin
    let addTx;
    
    // Check if we have any MNT to add
    const hasMNT = (isTokenXMNT && receivedX > 0n) || (isTokenYMNT && receivedY > 0n);
    
    if (hasMNT) {
      // For MNT, we need to send the native token amount as value
      const nativeAmount = isTokenXMNT ? receivedX : receivedY;

      if (nativeAmount <= 0n) {
        console.error("Invalid native token amount:", ethers.formatEther(nativeAmount));
        throw new Error("Invalid native token amount for addLiquidityNATIVE");
      }

      // Prepare parameters for addLiquidityNATIVE
      const liquidityParams = {
        token: isTokenXMNT ? tokenY : tokenX, // The non-MNT token
        binStep: binStep,
        amountTokenMin: isTokenXMNT ? receivedY : receivedX,
        amountNATIVEMin: nativeAmount,
        activeIdDesired: BigInt(activeId),
        idSlippage: 49n,
        deltaIds: [0],
        distributionX: [ethers.parseUnits("1", 18)],
        distributionY: [ethers.parseUnits("1", 18)],
        to: wallet.address,
        refundTo: wallet.address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      };
      
      // Get current nonce
      const nonce = await provider.getTransactionCount(wallet.address);
      
      addTx = await router.addLiquidityNATIVE(liquidityParams, { 
        value: nativeAmount,
        gasLimit: 5000000,
        nonce: nonce
      });
    } else {
      // If we only have non-MNT tokens, use regular addLiquidity
      const liquidityParams = {
        tokenX: tokenX,
        tokenY: tokenY,
        binStep: binStep,
        amountX: receivedX,
        amountY: receivedY,
        amountXMin: receivedX,
        amountYMin: receivedY,
        activeIdDesired: BigInt(activeId),
        idSlippage: 49n,
        deltaIds: [0],
        distributionX: [ethers.parseUnits("1", 18)],
        distributionY: [ethers.parseUnits("1", 18)],
        to: wallet.address,
        refundTo: wallet.address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      };
      
      // Get current nonce
      const nonce = await provider.getTransactionCount(wallet.address);
      
      addTx = await router.addLiquidity(liquidityParams, {
        nonce: nonce
      });
    }
    
    const addReceipt = await addTx.wait();
    
    // Log gas usage for adding liquidity
    const addGasUsed = addReceipt.gasUsed;
    const addGasPrice = addReceipt.gasPrice;
    const addGasCost = addGasUsed * addGasPrice;
    logToFile(`Add liquidity executed - Gas used: ${addGasUsed}, Gas cost: ${ethers.formatEther(addGasCost)} ETH, Tx hash: ${addReceipt.hash}`);
    
    console.log("✅ Liquidity added to active bin. Tx hash:", addReceipt.hash);
    
  } catch (error) {
    console.error("Error during rebalancing:", error);
    logToFile(`Error during rebalancing: ${error}`);
  }
}

// Helper to get top 10 DEXes by h24 volume and their prices
function getTop10DexPrices(dexData: any) {
  const pairs = dexData.pairs;
  const sorted = pairs.sort((a: any, b: any) => b.volume.h24 - a.volume.h24);
  return sorted.slice(0, 10).map((p: any) => ({
    price: Number(Number(p.priceUsd).toFixed(4)),
    volume: p.volume.h24
  }));
}

// Helper to get average price from top 10
function getMarketAveragePrice(top10: {price: number, volume: number}[]) {
  const sum = top10.reduce((acc, p) => acc + p.price, 0);
  return Number((sum / top10.length).toFixed(4));
}

// Helper to get bin info by price (rounded to 4 decimals)
function getBinByPrice(bins: any[], price: number) {
  return bins.find(b => Number(Number(b.priceXY).toFixed(4)) === price);
}

// Helper to get bin by id
function getBinById(bins: any[], binId: number) {
  return bins.find(b => b.binId === binId);
}

// Helper to get time in ms
function now() { return Date.now(); }

let inactiveBinSince: number | null = null;

async function monitorActiveBin() {
  console.log("Starting initial rebalancing...");
  // Fetch bins and calculate dynamic P
  const bins = await fetchMerchantMoeBins();
  // You may need to get tokenX/tokenY from contract or config
  const tokenX = 'USDC'; // replace with actual token symbol or address
  const tokenY = 'USDT'; // replace with actual token symbol or address
  let P = getDynamicP(bins, tokenX, tokenY);
  setMaxSwapsForToday(P);

  if (getSwapsToday() >= getMaxSwaps()) {
    console.log(`❌ Swap limit reached (${getSwapsToday()}/${getMaxSwaps()}) for today. Skipping initial rebalance.`);
  } else {
    await checkAndRebalanceLiquidity();
    incrementSwapsToday();
  }
  console.log("Initial rebalancing completed. Starting active bin monitoring...");
  let previousActiveId: number | null = null;
  let previousBinId: number | null = null;

  while (true) {
    try {
      // Always fetch fresh bins and recalculate P for the current active bin
      const bins = await fetchMerchantMoeBins();
      P = getDynamicP(bins, tokenX, tokenY);
      checkAndResetSwapLimitIfNeeded(P);
      const lbPair = new ethers.Contract(PAIR_ADDRESS, LBPairABI, wallet);
      const currentActiveId = Number(await lbPair.getActiveId());
      const dexData = await fetchDexScreenerData();
      const top10 = getTop10DexPrices(dexData);
      const marketAvg = getMarketAveragePrice(top10);
      const activeBin = getBinById(bins, currentActiveId);
      const myBinId: number = previousBinId !== null ? previousBinId : currentActiveId;
      const myBin = getBinById(bins, myBinId);
      const myBinPrice = myBin ? Number(Number(myBin.priceXY).toFixed(4)) : null;
      const activeBinPrice = activeBin ? Number(Number(activeBin.priceXY).toFixed(4)) : null;
      const myBinLiquidity = myBin ? myBin.reserveX + myBin.reserveY : 0;
      const activeBinLiquidity = activeBin ? activeBin.reserveX + activeBin.reserveY : 0;
      // Check if we are in active bin
      if (myBinId === currentActiveId) {
        inactiveBinSince = null;
        previousBinId = currentActiveId;
        previousActiveId = currentActiveId;
        logToFile(`Still in active bin ${currentActiveId}. No rebalance needed.`);
      } else {
        if (!inactiveBinSince) inactiveBinSince = now();
        const fourHours = 4 * 60 * 60 * 1000;
        if (now() - inactiveBinSince > fourHours) {
          if (getSwapsToday() >= getMaxSwaps()) {
            logToFile(`❌ Swap limit reached (${getSwapsToday()}/${getMaxSwaps()}) for today. Skipping rebalance.`);
          } else {
            logToFile(`In non-active bin ${myBinId} for >4h. Forcing rebalance to active bin ${currentActiveId}.`);
            await checkAndRebalanceLiquidity();
            incrementSwapsToday();
            previousBinId = currentActiveId;
            previousActiveId = currentActiveId;
            inactiveBinSince = null;
          }
        } else {
          if (activeBinPrice !== null && Math.abs(activeBinPrice - marketAvg) < 0.0001) {
            if (activeBinLiquidity >= 0.1 * myBinLiquidity) {
              if (getSwapsToday() >= getMaxSwaps()) {
                logToFile(`❌ Swap limit reached (${getSwapsToday()}/${getMaxSwaps()}) for today. Skipping rebalance.`);
              } else {
                logToFile(`Rebalancing: active bin price ${activeBinPrice} matches market avg ${marketAvg}, liquidity ok. Moving to active bin ${currentActiveId}.`);
                await checkAndRebalanceLiquidity();
                incrementSwapsToday();
                previousBinId = currentActiveId;
                previousActiveId = currentActiveId;
                inactiveBinSince = null;
              }
            } else {
              logToFile(`Not rebalancing: active bin liquidity too low (${activeBinLiquidity} < 10% of ${myBinLiquidity}).`);
            }
          } else if (myBinPrice !== null && Math.abs(myBinPrice - marketAvg) < 0.0001) {
            logToFile(`Not rebalancing: our bin price ${myBinPrice} matches market avg ${marketAvg}. Waiting for price to return.`);
          } else {
            logToFile(`Not rebalancing: neither active bin price (${activeBinPrice}) nor our bin price (${myBinPrice}) matches market avg (${marketAvg}).`);
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 60000));
    } catch (error) {
      console.error("Error in monitoring loop:", error);
      logToFile(`Error in monitoring loop: ${error}`);
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
  }
}

// Start the monitoring
monitorActiveBin().catch(e => {
  console.error("Fatal error:", e);
  logToFile(`Fatal error: ${e}`);
  process.exit(1);
});