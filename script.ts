import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
dotenv.config();

const LBRouterAddress = "0x1d8b6fA722230153BE08C4Fa4aa4B4c7cd01a95A".toLowerCase();
const PAIR_ADDRESS = "0x48c1a89af1102cad358549e9bb16ae5f96cddfec";
const walletAddress = "0x6c6402c6b99771cfc7aCc398f566c19Ba051aC8E";
const userPrivateKey = process.env.PRIVATE_KEY!;

// Load ABIs from files
const LBRouterABI = JSON.parse(fs.readFileSync(path.join(__dirname, "abis/LBRouterV21.json"), "utf8"));
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

async function withdrawAllLiquidity() {
  // 1. Dynamically get all information about the pool
  const lbPair = new ethers.Contract(PAIR_ADDRESS, LBPairABI, wallet);
  const tokenX = await lbPair.getTokenX();
  const tokenY = await lbPair.getTokenY();
  const binStep = await lbPair.getBinStep();
  const activeId = Number(await lbPair.getActiveId());

  // 2. Find all bins with liquidity for the wallet
  const range = 10; // can be adjusted
  const binsToCheck: number[] = [];
  for (let i = activeId - range; i <= activeId + range; i++) {
    binsToCheck.push(i);
  }
  const accounts = Array(binsToCheck.length).fill(walletAddress);
  const balances: bigint[] = await lbPair.balanceOfBatch(accounts, binsToCheck);

  // 3. Determine rewardable bins (active ±1)
  const REWARDABLE_BINS = 1;
  const rewardableBins = [activeId - REWARDABLE_BINS, activeId, activeId + REWARDABLE_BINS];

  // 4. Prepare lists for withdrawing liquidity only from non-active bins
  const ids: number[] = [];
  const amounts: bigint[] = [];
  balances.forEach((balance: bigint, index: number) => {
    const binId = binsToCheck[index];
    if (balance > 0n && !rewardableBins.includes(binId)) {
      ids.push(binId);
      amounts.push(balance);
      console.log(`Bin ${binId}: ${ethers.formatUnits(balance, 18)} shares (will be withdrawn)`);
    } else if (balance > 0n) {
      console.log(`Bin ${binId}: ${ethers.formatUnits(balance, 18)} shares (rewardable, keeping)`);
    }
  });

  if (ids.length === 0) {
    console.log("No non-active bins with liquidity to withdraw.");
    return;
  }

  // 5. Approve router to spend LP tokens
  const isApproved = await lbPair.isApprovedForAll(walletAddress, LBRouterAddress);
  if (!isApproved) {
    console.log("Providing approveForAll for router...");
    const approveTx = await lbPair.setApprovalForAll(LBRouterAddress, true);
    await approveTx.wait();
    console.log("ApproveForAll granted!");
  } else {
    console.log("ApproveForAll already exists");
  }

  // 6. Withdraw liquidity
  const amountXMin = 10000n;
  const amountYMin = 10000n;
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  try {
    console.log("Sending removeLiquidity transaction...");
    const removeTx = await router.removeLiquidity(
      tokenX,
      tokenY,
      binStep,
      amountXMin,
      amountYMin,
      ids,
      amounts,
      walletAddress,
      deadline
    );
    console.log(tokenX, tokenY, binStep, amountXMin, amountYMin, ids, amounts, walletAddress, deadline);
    console.log("Transaction sent:", removeTx.hash);
    const receipt = await removeTx.wait();
    console.log("✅ Liquidity withdrawn. Tx hash:", receipt.hash);
  } catch (error) {
    console.error("Error withdrawing liquidity:", error);
  }
}

// New function to directly call burn on the pair contract
async function directBurn() {
  console.log("Starting direct burn...");
  
  // 1. Get pair contract and information
  const lbPair = new ethers.Contract(PAIR_ADDRESS, LBPairABI, wallet);
  const activeId = Number(await lbPair.getActiveId());
  
  // 2. Find bins with liquidity
  const range = 10;
  const binsToCheck: number[] = [];
  for (let i = activeId - range; i <= activeId + range; i++) {
    binsToCheck.push(i);
  }
  const accounts = Array(binsToCheck.length).fill(walletAddress);
  const balances: bigint[] = await lbPair.balanceOfBatch(accounts, binsToCheck);
  
  // 3. Prepare IDs and amounts for bins with liquidity
  const ids: number[] = [];
  const amounts: bigint[] = [];
  balances.forEach((balance: bigint, index: number) => {
    const binId = binsToCheck[index];
    if (balance > 0n) {
      ids.push(binId);
      amounts.push(balance);
      console.log(`Bin ${binId}: ${ethers.formatUnits(balance, 18)} shares will be burned`);
    }
  });
  
  if (ids.length === 0) {
    console.log("No bins with liquidity found.");
    return;
  }
  
  try {
    console.log("Calling burn directly on pair contract...");
    const burnTx = await lbPair.burn(
      walletAddress, // from
      walletAddress, // to
      ids,           // ids
      amounts        // amounts
    );
    console.log("Transaction sent:", burnTx.hash);
    const receipt = await burnTx.wait();
    console.log("✅ Burn successful. Tx hash:", receipt.hash);
    console.log("Events:", receipt.logs);
  } catch (error) {
    console.error("Error burning LP tokens:", error);
  }
}

// New function to add liquidity (approximately $0.5 worth)
async function addLiquidity() {
  console.log("Starting add liquidity...");
  
  // 1. Get pair contract and information
  const lbPair = new ethers.Contract(PAIR_ADDRESS, LBPairABI, wallet);
  const tokenXAddress = await lbPair.getTokenX();
  const tokenYAddress = await lbPair.getTokenY();
  const binStep = await lbPair.getBinStep();
  const activeId = Number(await lbPair.getActiveId());
  
  // 2. Create token contracts
  const tokenX = new ethers.Contract(tokenXAddress, ERC20ABI, wallet);
  const tokenY = new ethers.Contract(tokenYAddress, ERC20ABI, wallet);
  
  // 3. Get decimals for proper formatting
  const decimalsX = await tokenX.decimals();
  const decimalsY = await tokenY.decimals();
  
  // 4. Set amounts (approximately $0.25 worth of each token)
  // For stablecoins like USDC/USDT, this would be 0.25 units each
  const amountX = ethers.parseUnits("0.25", decimalsX);
  const amountY = ethers.parseUnits("0.25", decimalsY);
  
  // 5. Set minimum amounts (95% of input to account for slippage)
  const amountXMin = amountX * 95n / 100n;
  const amountYMin = amountY * 95n / 100n;
  
  // 6. Approve tokens for router
  console.log("Approving tokens for router...");
  const allowanceX = await tokenX.allowance(walletAddress, LBRouterAddress);
  if (allowanceX < amountX) {
    const approveTxX = await tokenX.approve(LBRouterAddress, ethers.MaxUint256);
    await approveTxX.wait();
    console.log("TokenX approved");
  }
  
  const allowanceY = await tokenY.allowance(walletAddress, LBRouterAddress);
  if (allowanceY < amountY) {
    const approveTxY = await tokenY.approve(LBRouterAddress, ethers.MaxUint256);
    await approveTxY.wait();
    console.log("TokenY approved");
  }
  
  // 7. Prepare distribution arrays (concentrating around active ID)
  const ids = [activeId - 1, activeId, activeId + 1]; // Distribute around active ID
  const distributionX = [25, 50, 25]; // 25% in lower bin, 50% in active bin, 25% in upper bin
  const distributionY = [25, 50, 25]; // Same distribution for Y
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  
  try {
    console.log("Adding liquidity...");
    
    // Get the current nonce
    const nonce = await provider.getTransactionCount(walletAddress);
    console.log(`Using nonce: ${nonce}`);
    
    // Get current gas price and increase it by 50%
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ? feeData.gasPrice * 150n / 100n : undefined;
    console.log(`Using gas price: ${gasPrice ? ethers.formatUnits(gasPrice, 'gwei') : 'default'} gwei`);
    
    // Estimate gas for the transaction
    const gasEstimate = await router.addLiquidity.estimateGas(
      tokenXAddress,
      tokenYAddress,
      binStep,
      amountX,
      amountY,
      ids,
      distributionX,
      distributionY,
      walletAddress,
      deadline
    ).catch(e => {
      console.log("Gas estimation failed, using default high value:", e.message);
      return 5000000n; // Very high default value
    });
    
    // Add 50% buffer to gas estimate
    const gasLimit = typeof gasEstimate === 'bigint' ? 
      gasEstimate * 150n / 100n : 
      5000000n;
    
    console.log(`Gas estimate: ${gasEstimate}, using gas limit: ${gasLimit}`);
    
    // Use the format from LBRouterV21.json
    const addTx = await router.addLiquidity(
      tokenXAddress,
      tokenYAddress,
      binStep,
      amountX,
      amountY,
      ids,
      distributionX,
      distributionY,
      walletAddress,
      deadline,
      { 
        nonce, 
        gasPrice,
        gasLimit
      }
    );
    console.log("Transaction sent:", addTx.hash);
    const receipt = await addTx.wait();
    console.log("✅ Liquidity added. Tx hash:", receipt.hash);
  } catch (error) {
    console.error("Error adding liquidity:", error);
    
    // Try with direct method call if the first attempt fails
    console.log("\nAttempting alternative approach...");
    try {
      // Try with even higher gas limit and price
      const nonce = await provider.getTransactionCount(walletAddress);
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice ? feeData.gasPrice * 200n / 100n : undefined;
      
      console.log(`Using nonce: ${nonce}, gas price: ${gasPrice ? ethers.formatUnits(gasPrice, 'gwei') : 'default'} gwei`);
      
      const tx = {
        to: LBRouterAddress,
        nonce,
        gasPrice,
        gasLimit: 8000000n,
        data: router.interface.encodeFunctionData("addLiquidity", [
          tokenXAddress,
          tokenYAddress,
          binStep,
          amountX,
          amountY,
          ids,
          distributionX,
          distributionY,
          walletAddress,
          deadline
        ])
      };
      
      const rawTx = await wallet.sendTransaction(tx);
      console.log("Alternative transaction sent:", rawTx.hash);
      const receipt = await rawTx.wait();
      if (receipt) {
        console.log("✅ Liquidity added with alternative method. Tx hash:", receipt.hash);
      } else {
        console.log("⚠️ Transaction was sent but receipt is null. Tx hash:", rawTx.hash);
      }
    } catch (fallbackError) {
      console.error("Alternative approach also failed:", fallbackError);
    }
  }
}

// Helper function to wait for a specified time
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Choose which function to run
async function main() {
  const args = process.argv.slice(2);
  const action = args[0] || "withdraw";
  
  switch (action) {
    case "withdraw":
      await withdrawAllLiquidity();
      break;
    case "burn":
      await directBurn();
      break;
    case "add":
      await addLiquidity();
      break;
    case "sequence":
      console.log("=== STARTING SEQUENTIAL OPERATION ===");
      console.log("Step 1: Withdrawing liquidity...");
      await withdrawAllLiquidity();
      
      // Wait for 30 seconds to ensure the first transaction is processed
      console.log("\nWaiting 30 seconds for the first transaction to be processed...");
      await sleep(3000);
      
      console.log("\nStep 2: Adding new liquidity...");
      await addLiquidity();
      console.log("=== SEQUENTIAL OPERATION COMPLETED ===");
      break;
    default:
      console.log("Unknown action. Use 'withdraw', 'burn', 'add', or 'sequence'");
  }
}

main().catch(e => {
  console.error("Error:", e);
  process.exit(1);
});