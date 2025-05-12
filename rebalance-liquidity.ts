import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
dotenv.config();

const LBRouterAddress = "0x013e138EF6008ae5FDFDE29700e3f2Bc61d21E3a";
const PAIR_ADDRESS = "0x48c1a89af1102cad358549e9bb16ae5f96cddfec";
const userPrivateKey = process.env.PRIVATE_KEY!;

// Load ABIs from files
const LBRouterABI = JSON.parse(fs.readFileSync(path.join(__dirname, "abis/LBRouter.json"), "utf8"));
const LBPairABI = JSON.parse(fs.readFileSync(path.join(__dirname, "abis/LBPair.json"), "utf8"));

// ERC20 ABI for token interactions
const ERC20ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const provider = new ethers.JsonRpcProvider("https://rpc.mantle.xyz");
const wallet = new ethers.Wallet(userPrivateKey, provider);
const router = new ethers.Contract(LBRouterAddress, LBRouterABI, wallet);

async function approveIfNeeded(token: ethers.Contract, amount: bigint, label: string) {
  const allowance = await token.allowance(wallet.address, LBRouterAddress);
  if (allowance < amount) {
    console.log(`🔑 Approving ${label}...`);
    const tx = await token.approve(LBRouterAddress, ethers.MaxUint256);
    await tx.wait();
    console.log(`✅ ${label} approved.`);
  } else {
    console.log(`✅ ${label} allowance is sufficient.`);
  }
}

async function checkAndRebalanceLiquidity() {
  console.log("=== Checking liquidity positions ===");
  
  // Get pair contract and information
  const lbPair = new ethers.Contract(PAIR_ADDRESS, LBPairABI, wallet);
  const tokenX = await lbPair.getTokenX();
  const tokenY = await lbPair.getTokenY();
  const binStep = await lbPair.getBinStep();
  const activeId = Number(await lbPair.getActiveId());
  
  console.log(`Active bin ID: ${activeId}`);
  console.log(`Token X: ${tokenX}`);
  console.log(`Token Y: ${tokenY}`);
  console.log(`Bin step: ${binStep}`);
  
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
        console.log(`Bin ${binId}: ${ethers.formatUnits(balance, 18)} shares (active/rewardable)`);
        activeBinsLiquidity += balance;
        activeBinsCount++;
      } else {
        console.log(`Bin ${binId}: ${ethers.formatUnits(balance, 18)} shares (non-active)`);
        nonActiveBinsLiquidity += balance;
        nonActiveBinsCount++;
        
        // Add to withdrawal lists
        ids.push(binId);
        amounts.push(balance);
      }
      totalLiquidity += balance;
    }
  });
  
  console.log("\n=== Liquidity Summary ===");
  console.log(`Total bins with liquidity: ${activeBinsCount + nonActiveBinsCount}`);
  console.log(`Active bins: ${activeBinsCount} (${ethers.formatUnits(activeBinsLiquidity, 18)} shares)`);
  console.log(`Non-active bins: ${nonActiveBinsCount} (${ethers.formatUnits(nonActiveBinsLiquidity, 18)} shares)`);
  console.log(`Total liquidity: ${ethers.formatUnits(totalLiquidity, 18)} shares`);
  
  // If no non-active bins, exit
  if (ids.length === 0) {
    console.log("\nNo non-active bins with liquidity to rebalance. Exiting.");
    return;
  }
  
  // Withdraw liquidity from non-active bins
  console.log("\n=== Withdrawing liquidity from non-active bins ===");
  
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
    
    console.log(`Withdrawing from ${ids.length} bins...`);
    const removeTx = await router.removeLiquidity(
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
    console.log("Transaction sent:", removeTx.hash);
    const receipt = await removeTx.wait();
    console.log("✅ Liquidity withdrawn. Tx hash:", receipt.hash);
    
    // Get new balances after withdrawal
    const newBalanceX = await tokenXContract.balanceOf(wallet.address);
    const newBalanceY = await tokenYContract.balanceOf(wallet.address);
    
    // Calculate received amounts
    const receivedX = newBalanceX - initialBalanceX;
    const receivedY = newBalanceY - initialBalanceY;
    
    const tokenXDecimals = await tokenXContract.decimals();
    const tokenYDecimals = await tokenYContract.decimals();
    
    console.log("\n=== Adding liquidity to active bin ===");
    console.log(`Received X: ${ethers.formatUnits(receivedX, tokenXDecimals)}`);
    console.log(`Received Y: ${ethers.formatUnits(receivedY, tokenYDecimals)}`);
    
    // Approve tokens if needed
    await approveIfNeeded(tokenXContract, BigInt(receivedX), "TokenX");
    await approveIfNeeded(tokenYContract, BigInt(receivedY), "TokenY");
    
    // Add liquidity to active bin
    const liquidityParams = {
      tokenX,
      tokenY,
      binStep: 1,
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
    
    console.log("🚀 Adding liquidity to active bin...");
    const addTx = await router.addLiquidity(liquidityParams);
    const addReceipt = await addTx.wait();
    console.log("✅ Liquidity added to active bin. Tx hash:", addReceipt.hash);
    
  } catch (error) {
    console.error("Error during rebalancing:", error);
  }
}

// Run the script
checkAndRebalanceLiquidity().catch(e => {
  console.error("Error:", e);
  process.exit(1);
}); 