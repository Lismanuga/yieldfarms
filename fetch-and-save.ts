import fetch from 'node-fetch';
import * as fs from 'fs';

export async function fetchMerchantMoeBins(): Promise<any[]> {
  const res = await fetch('https://barn.merchantmoe.com/v1/lb/bin/mantle/0x48C1A89af1102Cad358549e9Bb16aE5f96CddFEc/8388607?filterBy=1d&radius=100');
  return (await res.json()) as any[];
}

export async function fetchDexScreenerData(): Promise<any> {
  const res = await fetch('https://api.dexscreener.com/latest/dex/search/?q=usdc/usdt');
  return await res.json();
}

async function fetchAndSave(url: string, fileName: string) {
  try {
    const response = await fetch(url);
    const data = await response.text();
    fs.writeFileSync(fileName, data);
    console.log(`Saved response from ${url} to ${fileName}`);
  } catch (error) {
    console.error(`Error fetching ${url}:`, error);
  }
}

async function main() {
  await fetchAndSave(
    'https://api.dexscreener.com/latest/dex/search/?q=usdc/usdt',
    'dexscreener_usdc_usdt.txt'
  );
  await fetchAndSave(
    'https://barn.merchantmoe.com/v1/lb/bin/mantle/0x48C1A89af1102Cad358549e9Bb16aE5f96CddFEc/8388607?filterBy=1d&radius=100',
    'merchantmoe_bin_data.txt'
  );
}

main(); 