import { ethers } from 'ethers';
import createLogger from '../logs/index.js';

const log = createLogger('trading');

const BASE_RPC = 'https://mainnet.base.org';
const provider = new ethers.JsonRpcProvider(BASE_RPC);

export const tradingTools = {
  get_balance: {
    name: 'get_balance',
    description: 'Check ETH balance of a wallet on Base network',
    parameters: { address: 'string' },
    execute: async (args) => {
      try {
        // Super defensive address extraction
        let addr = args.address || args.addr || args.target || (Array.isArray(args) ? args[0] : null);
        
        // If args itself is a string that starts with 0x, use it
        if (!addr && typeof args === 'string' && args.startsWith('0x')) addr = args;
        
        // If no address found yet, check all values in args object
        if (!addr && typeof args === 'object') {
            addr = Object.values(args).find(v => typeof v === 'string' && v.startsWith('0x'));
        }

        if (!addr) return { success: false, error: 'No valid wallet address found in arguments' };
        
        // Final trim and validation
        addr = addr.trim();
        if (!ethers.isAddress(addr)) return { success: false, error: `Invalid Ethereum address: ${addr}` };

        const balance = await provider.getBalance(addr);
        return { success: true, output: `${ethers.formatEther(balance)} ETH` };
      } catch (err) {
        log.error('get_balance error', { error: err.message });
        return { success: false, error: err.message };
      }
    }
  },
  get_token_price: {
    name: 'get_token_price',
    description: 'Get price of a token in USDC',
    parameters: { symbol: 'string' },
    execute: async (args) => {
      let sym = args.symbol || args.coin || args.token || (Array.isArray(args) ? args[0] : (typeof args === 'string' ? args : ''));
      if (!sym) return { success: false, error: 'No token symbol provided' };
      
      const mockPrices = { 'ETH': '2500', 'BTC': '65000', 'SOL': '140', 'BNB': '600', 'USDC': '1' };
      const price = mockPrices[sym.toUpperCase().trim()];
      if (price) return { success: true, output: `$${price}` };
      return { success: false, error: 'Price not found for symbol: ' + sym };
    }
  }
};
