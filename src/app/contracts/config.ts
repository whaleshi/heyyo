import { chainId } from '../../../shared/contracts';
const env = import.meta.env;
export const rpcUrl = env?.VITE_HEYYO_RPC_URL?.trim() || '';
export const networkName = env?.VITE_HEYYO_NETWORK_NAME?.trim() || `Heyyo (${chainId})`;
export const nativeSymbol = env?.VITE_HEYYO_NATIVE_SYMBOL?.trim() || 'ETH';
export const networkReady = /^https?:\/\//.test(rpcUrl);
export const launchConfig = {
  templateId: env?.VITE_HEYYO_TEMPLATE_ID || '', dexConfigId: env?.VITE_HEYYO_DEX_CONFIG_ID || '',
  paymentTokenConfigId: env?.VITE_HEYYO_PAYMENT_CONFIG_ID || '',
};
export const creationReady = networkReady && Object.values(launchConfig).every(v => /^[1-9]\d*$/.test(v));
