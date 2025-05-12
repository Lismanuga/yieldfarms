import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

const LBRouterAddress = "0x013e138EF6008ae5FDFDE29700e3f2Bc61d21E3a";
const walletAddress = "0xd770147aa72227b7801a62411802d4e7ee837771"; // замінив на той, що в успішній транзакції
const userPrivateKey = process.env.PRIVATE_KEY!;

// ABI
const LBRouterABI = JSON.parse(fs.readFileSync(path.join(__dirname, "abis/LBRouter.json"), "utf8"));
const ERC20ABI = [
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

// Tokens from calldata
const tokenX = "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9";
const tokenY = "0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE";

const provider = new ethers.JsonRpcProvider("https://rpc.mantle.xyz");
const wallet = new ethers.Wallet(userPrivateKey, provider);
const router = new ethers.Contract(LBRouterAddress, LBRouterABI, wallet);

const approveIfNeeded = async (token: ethers.Contract, amount: bigint, label: string) => {
  const allowance = await token.allowance(wallet.address, LBRouterAddress);
  if (allowance < amount) {
    console.log(`🔑 Approving ${label}...`);
    const tx = await token.approve(LBRouterAddress, ethers.MaxUint256);
    await tx.wait();
    console.log(`✅ ${label} approved.`);
  } else {
    console.log(`✅ ${label} allowance is sufficient.`);
  }
};

async function main() {
  const tokenXContract = new ethers.Contract(tokenX, ERC20ABI, wallet);
  const tokenYContract = new ethers.Contract(tokenY, ERC20ABI, wallet);

  const tokenXDecimals = await tokenXContract.decimals();
  const tokenYDecimals = await tokenYContract.decimals();

  const amountX = ethers.parseUnits("0.5", tokenXDecimals); // 0.5 USDC
  const amountY = ethers.parseUnits("0.5", tokenYDecimals); // 0.5 USDT

  await approveIfNeeded(tokenXContract, amountX, "TokenX");
  await approveIfNeeded(tokenYContract, amountY, "TokenY");

  const liquidityParams = {
    tokenX,
    tokenY,
    binStep: 1,
    amountX,
    amountY,
    amountXMin: amountX, // для 1:1 додавання можна без slippage
    amountYMin: amountY,
    activeIdDesired: 8388607n, // важливо!
    idSlippage: 49n,           // 0x31
    deltaIds: [0],
    distributionX: [ethers.parseUnits("1", 18)], // 1.0
    distributionY: [ethers.parseUnits("1", 18)],
    to: walletAddress,
    refundTo: walletAddress,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  };

  console.log("🚀 Submitting transaction...");

  const tx = await router.addLiquidity(liquidityParams);
  const receipt = await tx.wait();

  console.log("✅ Transaction succeeded!");
  console.log("Tx Hash:", receipt.hash);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
