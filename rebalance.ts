import { config as dotenvConfig } from "dotenv";
dotenvConfig();

import { createPublicClient, createWalletClient, http, getContract, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mantle } from "viem/chains";
import LBPairAbi from "./abis/LBPair.json";
import LBRouterV21Abi from "./abis/LBRouterV21.json";
import * as readline from 'readline';

// Константи
const ROUTER_ADDRESS = "0x1d8b6fA722230153BE08C4Fa4aa4B4c7cd01a95A";
const PAIR_ADDRESS = "0x48c1a89af1102cad358549e9bb16ae5f96cddfec";

// Функція для запиту підтвердження у користувача
function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

async function checkAndRebalanceLiquidity() {
  try {
    const PRIVATE_KEY = process.env.PRIVATE_KEY;
    if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY is not set in .env");
    const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

    // Створюємо клієнти
    const publicClient = createPublicClient({
      chain: mantle,
      transport: http(),
    });
    const walletClient = createWalletClient({
      account,
      chain: mantle,
      transport: http(),
    });
    const walletAddress = account.address;

    // Створюємо контракти
    const pairContract = getContract({
      address: PAIR_ADDRESS as `0x${string}`,
      abi: LBPairAbi,
      client: publicClient,
    });
    const routerContract = getContract({
      address: ROUTER_ADDRESS as `0x${string}`,
      abi: LBRouterV21Abi,
      client: publicClient,
    });

    // Отримуємо активний бін
    const activeId = await pairContract.read.getActiveId() as bigint;
    console.log("\nActive Bin ID:", activeId);

    // Отримуємо binStep
    const binStep = await pairContract.read.getBinStep() as number;

    // Отримуємо токени
    const tokenX = await pairContract.read.getTokenX() as string;
    const tokenY = await pairContract.read.getTokenY() as string;

    // Перевіряємо баланс в діапазоні бінів навколо активного
    const range = 10;
    const binsToCheck: number[] = [];
    for (let i = Number(activeId) - range; i <= Number(activeId) + range; i++) {
      binsToCheck.push(i);
    }

    // Отримуємо баланс для всіх бінів
    const addresses = Array(binsToCheck.length).fill(walletAddress);
    const balances = await pairContract.read.balanceOfBatch([addresses, binsToCheck]) as bigint[];

    // Знаходимо баланс активного біна
    const activeBinIndex = binsToCheck.indexOf(Number(activeId));
    const activeBinBalance = balances[activeBinIndex];
    console.log(`Active Bin Balance: ${formatUnits(activeBinBalance, 18)} shares`);

    // Знаходимо біни з ліквідністю, крім активного
    const nonActiveBins = binsToCheck.filter((binId, index) => 
      balances[index] > BigInt(0) && binId !== Number(activeId)
    );

    if (nonActiveBins.length === 0) {
      console.log("\nNo non-active bins with liquidity found!");
      return;
    }

    // Виводимо інформацію про неактивні біни
    console.log("\nFound non-active bins with liquidity:");
    let totalLiquidity = BigInt(0);
    const ids: bigint[] = [];
    const amounts: bigint[] = [];
    for (const binId of nonActiveBins) {
      const balanceIndex = binsToCheck.indexOf(binId);
      const balance = balances[balanceIndex];
      totalLiquidity += balance;
      ids.push(BigInt(binId));
      amounts.push(balance);
      console.log(`Bin ${binId}: ${formatUnits(balance, 18)} shares`);
    }
    console.log(`\nTotal liquidity in non-active bins: ${formatUnits(totalLiquidity, 18)} shares`);
    console.log(`Total liquidity after rebalance: ${formatUnits(activeBinBalance + totalLiquidity, 18)} shares`);

    // Запитуємо підтвердження
    const answer = await askQuestion("\nDo you want to rebalance this liquidity to the active bin? (Y/N): ");
    
    if (answer.toLowerCase() !== 'y') {
      console.log("\nRebalancing cancelled by user.");
      return;
    }

    console.log("\nStarting rebalancing process...");

    // REMOVE LIQUIDITY (batch)
    const amountXmin = BigInt(0);
    const amountYmin = BigInt(0);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800); // 30 хвилин
    const removeArgs = [
      tokenX,
      tokenY,
      binStep,
      amountXmin,
      amountYmin,
      ids,
      amounts,
      walletAddress,
      deadline
    ];
    const { request: removeReq } = await publicClient.simulateContract({
      address: ROUTER_ADDRESS as `0x${string}`,
      abi: LBRouterV21Abi,
      functionName: "removeLiquidity",
      args: removeArgs,
      account,
    });
    const removeTxHash = await walletClient.writeContract(removeReq);
    console.log(`Removed liquidity from bins, tx: ${removeTxHash}`);

    // ADD LIQUIDITY (в активний бін)
    // Для простоти: додаємо всю ліквідність в один бін (activeId)
    // distributionX = [totalLiquidity], distributionY = [0]
    const addAmountX = totalLiquidity;
    const addAmountY = BigInt(0);
    const addIds = [activeId];
    const distributionX = [totalLiquidity];
    const distributionY = [BigInt(0)];
    const addArgs = [
      tokenX,
      tokenY,
      binStep,
      addAmountX,
      addAmountY,
      addIds,
      distributionX,
      distributionY,
      walletAddress,
      deadline
    ];
    const { request: addReq } = await publicClient.simulateContract({
      address: ROUTER_ADDRESS as `0x${string}`,
      abi: LBRouterV21Abi,
      functionName: "addLiquidity",
      args: addArgs,
      account,
    });
    const addTxHash = await walletClient.writeContract(addReq);
    console.log(`Added liquidity to active bin ${activeId}, tx: ${addTxHash}`);

    console.log("\nRebalancing completed!");

  } catch (error) {
    console.error("Error during rebalancing:", error);
  }
}

// Запускаємо перевірку і ребаланс
checkAndRebalanceLiquidity(); 