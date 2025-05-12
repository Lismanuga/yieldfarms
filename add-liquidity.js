"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var ethers_1 = require("ethers");
var dotenv = require("dotenv");
var fs = require("fs");
var path = require("path");
var LBRouter = require("./abis/LBRouter.json");
dotenv.config();
// Configuration
var AMOUNT_TOKEN_X = "1"; // Amount of Token X to add (in token units)
var AMOUNT_TOKEN_Y = "1"; // Amount of Token Y to add (in token units)
var LBRouterAddress = "0x013e138EF6008ae5FDFDE29700e3f2Bc61d21E3a";
var PAIR_ADDRESS = "0x48c1a89af1102cad358549e9bb16ae5f96cddfec";
var walletAddress = "0x6c6402c6b99771cfc7aCc398f566c19Ba051aC8E";
var userPrivateKey = process.env.PRIVATE_KEY;
// Load ABIs from files
var LBPairABI = JSON.parse(fs.readFileSync(path.join(__dirname, "abis/LBPair.json"), "utf8"));
var ERC20ABI = [
    "function decimals() view returns (uint8)",
    "function balanceOf(address account) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)"
];
var provider = new ethers_1.ethers.JsonRpcProvider("https://rpc.mantle.xyz");
var wallet = new ethers_1.ethers.Wallet(userPrivateKey, provider);
var router = new ethers_1.ethers.Contract(LBRouterAddress, LBRouter, wallet);
function simulateAddLiquidity() {
    return __awaiter(this, void 0, void 0, function () {
        var lbPair, tokenX, tokenY, binStep, activeId, _a, tokenXContract, tokenYContract, tokenXDecimals, tokenYDecimals, amountX, amountY, amountXMin, amountYMin, deltaIds, distributionX, distributionY, deadline, liquidityParams, result, err_1;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    console.log("=== Simulating addLiquidity on Joe V2 ===");
                    lbPair = new ethers_1.ethers.Contract(PAIR_ADDRESS, LBPairABI, wallet);
                    return [4 /*yield*/, lbPair.getTokenX()];
                case 1:
                    tokenX = _b.sent();
                    return [4 /*yield*/, lbPair.getTokenY()];
                case 2:
                    tokenY = _b.sent();
                    return [4 /*yield*/, lbPair.getBinStep()];
                case 3:
                    binStep = _b.sent();
                    _a = Number;
                    return [4 /*yield*/, lbPair.getActiveId()];
                case 4:
                    activeId = _a.apply(void 0, [_b.sent()]);
                    console.log("Active bin ID: ".concat(activeId));
                    console.log("Token X: ".concat(tokenX));
                    console.log("Token Y: ".concat(tokenY));
                    console.log("Bin step: ".concat(binStep));
                    tokenXContract = new ethers_1.ethers.Contract(tokenX, ERC20ABI, wallet);
                    tokenYContract = new ethers_1.ethers.Contract(tokenY, ERC20ABI, wallet);
                    return [4 /*yield*/, tokenXContract.decimals()];
                case 5:
                    tokenXDecimals = _b.sent();
                    return [4 /*yield*/, tokenYContract.decimals()];
                case 6:
                    tokenYDecimals = _b.sent();
                    amountX = ethers_1.ethers.parseUnits(AMOUNT_TOKEN_X, tokenXDecimals);
                    amountY = ethers_1.ethers.parseUnits(AMOUNT_TOKEN_Y, tokenYDecimals);
                    amountXMin = amountX * 95n / 100n;
                    amountYMin = amountY * 95n / 100n;
                    deltaIds = [0];
                    distributionX = [100];
                    distributionY = [100];
                    deadline = Math.floor(Date.now() / 1000) + 3600;
                    liquidityParams = {
                        tokenX: tokenX,
                        tokenY: tokenY,
                        binStep: binStep,
                        amountX: amountX,
                        amountY: amountY,
                        amountXMin: amountXMin,
                        amountYMin: amountYMin,
                        activeIdDesired: activeId,
                        idSlippage: 10,
                        deltaIds: deltaIds,
                        distributionX: distributionX,
                        distributionY: distributionY,
                        to: walletAddress,
                        refundTo: walletAddress,
                        deadline: deadline
                    };
                    console.log("\n🔍 Simulating with parameters:");
                    console.log({
                        tokenX: tokenX,
                        tokenY: tokenY,
                        binStep: binStep,
                        activeId: activeId,
                        amountX: ethers_1.ethers.formatUnits(amountX, tokenXDecimals),
                        amountY: ethers_1.ethers.formatUnits(amountY, tokenYDecimals),
                        amountXMin: ethers_1.ethers.formatUnits(amountXMin, tokenXDecimals),
                        amountYMin: ethers_1.ethers.formatUnits(amountYMin, tokenYDecimals),
                        deltaIds: deltaIds,
                        distributionX: distributionX,
                        distributionY: distributionY
                    });
                    _b.label = 7;
                case 7:
                    _b.trys.push([7, 9, , 10]);
                    return [4 /*yield*/, router.getFunction("addLiquidity").staticCall(liquidityParams)];
                case 8:
                    result = _b.sent();
                    console.log("\n✅ Simulation result:");
                    console.log("amountXAdded: ".concat(ethers_1.ethers.formatUnits(result[0], tokenXDecimals)));
                    console.log("amountYAdded: ".concat(ethers_1.ethers.formatUnits(result[1], tokenYDecimals)));
                    console.log("amountXLeft: ".concat(ethers_1.ethers.formatUnits(result[2], tokenXDecimals)));
                    console.log("amountYLeft: ".concat(ethers_1.ethers.formatUnits(result[3], tokenYDecimals)));
                    console.log("depositIds:", result[4].map(function (id) { return id.toString(); }));
                    console.log("liquidityMinted:", result[5].map(function (liq) { return liq.toString(); }));
                    return [3 /*break*/, 10];
                case 9:
                    err_1 = _b.sent();
                    console.error("\n❌ Simulation failed:");
                    console.error(err_1);
                    return [3 /*break*/, 10];
                case 10: return [2 /*return*/];
            }
        });
    });
}
simulateAddLiquidity().catch(function (err) {
    console.error("Error:", err);
    process.exit(1);
});
