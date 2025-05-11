import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const LBRouterAddress = "0x1d8b6fA722230153BE08C4Fa4aa4B4c7cd01a95A".toLowerCase();
const PAIR_ADDRESS = "0x48c1a89af1102cad358549e9bb16ae5f96cddfec";
const userPrivateKey = process.env.PRIVATE_KEY!;

const LBRouterABI = [
  "function removeLiquidity(address,address,uint16,uint256,uint256,uint256[],uint256[],address,uint256) returns (uint256,uint256)"
];

const LBPairABI = [
  "function getTokenX() view returns (address)",
  "function getTokenY() view returns (address)",
  "function getBinStep() view returns (uint16)",
  "function balanceOf(address,uint256) view returns (uint256)",
  "function balanceOfBatch(address[], uint256[]) view returns (uint256[])"
];

const provider = new ethers.JsonRpcProvider("https://rpc.mantle.xyz");
const wallet = new ethers.Wallet(userPrivateKey, provider);
const router = new ethers.Contract(LBRouterAddress, LBRouterABI, wallet);

async function withdrawAllLiquidity() {
  // 1. Отримуємо інформацію про пул
  const lbPair = new ethers.Contract(PAIR_ADDRESS, LBPairABI, wallet);
  const tokenX = await lbPair.getTokenX();
  const tokenY = await lbPair.getTokenY();
  const binStep = await lbPair.getBinStep();

  console.log("Token X:", tokenX);
  console.log("Token Y:", tokenY);
  console.log("Bin Step:", binStep);

  // 2. Використовуємо конкретні біни з ліквідністю
  const binsWithLiquidity = [8388603, 8388604, 8388605, 8388606, 8388607, 8388608];
  const accounts = Array(binsWithLiquidity.length).fill(wallet.address);
  
  // Отримуємо баланси для цих бінів
  const balances: bigint[] = await lbPair.balanceOfBatch(accounts, binsWithLiquidity);
  
  // Фільтруємо біни з ненульовим балансом
  const ids: number[] = [];
  const amounts: bigint[] = [];
  
  balances.forEach((balance, index) => {
    if (balance > 0n) {
      ids.push(binsWithLiquidity[index]);
      amounts.push(balance);
      console.log(`Bin ${binsWithLiquidity[index]}: ${ethers.formatUnits(balance, 18)} shares`);
    }
  });

  if (ids.length === 0) {
    console.log("Немає ліквідності для виводу");
    return;
  }

  // 3. Виконуємо виведення всіх знайдених токенів ліквідності
  console.log("\nПочинаємо виведення ліквідності...");
  console.log("IDs:", ids);
  console.log("Amounts:", amounts.map(a => ethers.formatUnits(a, 18)));
  
  const deadline = Math.floor(Date.now()/1000) + 300; // 5 хвилин з запасом
  
  try {
    console.log("Відправляємо транзакцію...");
    const removeTx = await router.removeLiquidity(
      tokenX, tokenY, binStep,
      0, 0,               // minAmounts = 0 (виводимо все що є)
      ids, amounts,
      wallet.address,     // куди надіслати повернуті токени
      deadline
    );
    console.log("Транзакція відправлена:", removeTx);
    console.log("Очікуємо підтвердження...");
    const receipt = await removeTx.wait();
    console.log("Receipt:", receipt);
    console.log(`✅ Ліквідність вилучено. Tx hash: ${receipt.hash}`);
  } catch (error) {
    console.error("Помилка при виведенні ліквідності:", error);
    const err = error as any;
    if (err.data) {
      console.error("Error data:", err.data);
    }
  }
}

withdrawAllLiquidity().catch(e => {
  console.error("Помилка:", e);
  process.exit(1);
}); 