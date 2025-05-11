import { createPublicClient, http, getContract, formatUnits } from "viem";
import { mantle } from "viem/chains";
import LBPairAbi from "./abis/LBPair.json";

async function readLBPairInfo(pairAddress: string, walletAddress: string) {
  // Створюємо клієнт для взаємодії з блокчейном
  const publicClient = createPublicClient({
    chain: mantle,
    transport: http(),
  });

  // Створюємо контракт
  const pairContract = getContract({
    address: pairAddress as `0x${string}`,
    abi: LBPairAbi,
    client: publicClient,
  });

  try {

    // Отримуємо адреси токенів
    const tokenX = await pairContract.read.getTokenX();
    const tokenY = await pairContract.read.getTokenY();
    console.log("Token X:", tokenX);
    console.log("Token Y:", tokenY);

    // Отримуємо резерви
    const [reserveX, reserveY] = await pairContract.read.getReserves() as [bigint, bigint];
    console.log("Reserve X:", formatUnits(reserveX, 18)); // Припускаємо 18 децималів
    console.log("Reserve Y:", formatUnits(reserveY, 18));

    // Отримуємо параметри хуків (включаючи rewarder)
    const hooksParams = await pairContract.read.getLBHooksParameters() as string;
    const rewarder = "0x" + hooksParams.slice(-40);
    console.log("Rewarder:", rewarder);

    // Перевіряємо баланс гаманця
    console.log("\nWallet Balance Check:");
    console.log("Wallet Address:", walletAddress);

    const activeId = await pairContract.read.getActiveId() as number;
    console.log("Active Bin ID:", activeId);

    // Отримуємо крок біну
    const binStep = await pairContract.read.getBinStep();
    console.log("Bin Step:", binStep);

    // Перевіряємо баланс в діапазоні бінів навколо активного
    const range = 10; // перевіряємо 10 бінів в кожну сторону
    const binsToCheck: number[] = [];
    for (let i = activeId - range; i <= activeId + range; i++) {
      binsToCheck.push(i);
    }

    // Створюємо масив адрес гаманця для кожного біну
    const addresses = Array(binsToCheck.length).fill(walletAddress);

    // Отримуємо баланс для всіх бінів
    const balances = await pairContract.read.balanceOfBatch([addresses, binsToCheck]) as bigint[];
    
    // Виводимо інформацію про біни з ненульовим балансом
    console.log("\nActive Positions:");
    for (let i = 0; i < balances.length; i++) {
      if (balances[i] > BigInt(0)) {
        const binId = binsToCheck[i];
        const isActiveBin = binId === activeId;
        console.log(`Bin ${binId}${isActiveBin ? ' (rewarded)' : ''}: ${formatUnits(balances[i], 18)} shares`);
      }
    }

  } catch (error) {
    console.error("Error reading LBPair:", error);
  }
}

// Приклад використання
const pairAddress = "0x48c1a89af1102cad358549e9bb16ae5f96cddfec";
const walletAddress = "0x6c6402c6b99771cfc7aCc398f566c19Ba051aC8E";
readLBPairInfo(pairAddress, walletAddress); 