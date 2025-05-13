import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import LBRouterABI from "./abis/LBRouter.json";
import LBPairABI from "./abis/LBPair.json";
import ERC20ABI from "./abis/ERC20.json";
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

async function monitorActiveBin() {
  console.log("Starting initial rebalancing...");
  
  // Perform initial rebalancing
  await checkAndRebalanceLiquidity();
  
  console.log("Initial rebalancing completed. Starting active bin monitoring...");
  let previousActiveId: number | null = null;
  
  while (true) {
    try {
      const lbPair = new ethers.Contract(PAIR_ADDRESS, LBPairABI, wallet);
      const currentActiveId = Number(await lbPair.getActiveId());
      
      if (previousActiveId === null) {
        console.log(`Initial active bin ID: ${currentActiveId}`);
        previousActiveId = currentActiveId;
      } else if (currentActiveId !== previousActiveId) {
        console.log(`Active bin changed from ${previousActiveId} to ${currentActiveId}`);
        logToFile(`Active bin changed from ${previousActiveId} to ${currentActiveId}`);
        await checkAndRebalanceLiquidity();
        previousActiveId = currentActiveId;
      }
      
      // Wait for 1 minute
      await new Promise(resolve => setTimeout(resolve, 60000));
    } catch (error) {
      console.error("Error in monitoring loop:", error);
      logToFile(`Error in monitoring loop: ${error}`);
      // Wait for 1 minute before retrying
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