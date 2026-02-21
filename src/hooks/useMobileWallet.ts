/**
 * ============================================================================
 * Mobile Wallet Adapter Hook
 * ============================================================================
 * Connects to Solana wallets (Phantom, Solflare) on Android via MWA intents.
 * On desktop this hook is a no-op — wallet ops go through Tauri IPC instead.
 *
 * MWA flow:
 *   1. transact() dispatches an Android intent to a local wallet app
 *   2. Wallet app opens, user approves connection
 *   3. Encrypted WebSocket channel established on localhost:49200
 *   4. App sends sign/send requests through the channel
 * ============================================================================
 */

import { useState, useCallback, useRef } from 'react';
import { isMobile } from './usePlatform';
import { MobileWalletAPI } from '../api';
import type { WalletInfo } from '../types';

// MWA types — imported dynamically to avoid bundling on desktop
type AuthorizationResult = {
  auth_token: string;
  accounts: Array<{
    address: string;
    label?: string;
  }>;
  wallet_uri_base?: string;
};

interface MobileWalletState {
  /** Connected wallet address (base58) */
  address: string | null;
  /** Cached auth token for session reuse */
  authToken: string | null;
  /** Whether MWA connection is active */
  isConnected: boolean;
  /** Last known SOL balance */
  balanceSol: number;
}

interface MWAWallet {
  authorize(opts: { identity: typeof APP_IDENTITY; cluster: string }): Promise<AuthorizationResult>;
  reauthorize(opts: { identity: typeof APP_IDENTITY; auth_token: string }): Promise<AuthorizationResult>;
  signAndSendTransactions(opts: { payloads: string[]; options?: Record<string, unknown> }): Promise<Readonly<{ signatures: string[] }>>;
  signTransactions(opts: { payloads: string[]; }): Promise<Readonly<{ signed_payloads: string[] }>>;
}

const APP_IDENTITY = {
  name: 'AgenC Operator',
  uri: 'https://agenc.ai',
  icon: '/icons/128x128.png',
};

export function useMobileWallet() {
  const [state, setState] = useState<MobileWalletState>({
    address: null,
    authToken: null,
    isConnected: false,
    balanceSol: 0,
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  /**
   * Connect to a wallet via MWA.
   * Launches Phantom/Solflare via Android intent, user approves.
   */
  const connect = useCallback(async (): Promise<WalletInfo> => {
    if (!isMobile()) {
      throw new Error('MWA connect is only available on mobile');
    }

    // Dynamic import to avoid bundling react-native deps on desktop
    const { transact } = await import('@solana-mobile/mobile-wallet-adapter-protocol');

    let walletInfo: WalletInfo = { address: '', balance_sol: 0, is_connected: false };

    await transact(async (wallet: MWAWallet) => {
      const result: AuthorizationResult = await wallet.authorize({
        identity: APP_IDENTITY,
        cluster: 'mainnet-beta',
      });

      const address = result.accounts[0]?.address;
      if (!address) throw new Error('No accounts returned from wallet');

      // Fetch balance via Tauri backend (uses configured RPC URL)
      let balance = 0;
      try {
        balance = await MobileWalletAPI.getBalanceByAddress(address);
      } catch (e) {
        console.warn('[MWA] Balance fetch failed, continuing:', e);
      }

      setState({
        address,
        authToken: result.auth_token,
        isConnected: true,
        balanceSol: balance,
      });

      walletInfo = {
        address,
        balance_sol: balance,
        is_connected: true,
      };

      // Persist auth token for session reuse
      try {
        sessionStorage.setItem('mwa-auth-token', result.auth_token);
        sessionStorage.setItem('mwa-address', address);
      } catch {}
    });

    return walletInfo;
  }, []);

  /**
   * Sign and send a serialized transaction via MWA.
   * The wallet app handles signing — keys never touch our app.
   */
  const signAndSendTransaction = useCallback(async (serializedTx: Uint8Array): Promise<string> => {
    if (!isMobile()) {
      throw new Error('MWA signAndSend is only available on mobile');
    }

    const { transact } = await import('@solana-mobile/mobile-wallet-adapter-protocol');

    let signature = '';

    await transact(async (wallet: MWAWallet) => {
      // Re-authorize with cached token
      const authToken = stateRef.current.authToken;
      if (authToken) {
        try {
          await wallet.reauthorize({ identity: APP_IDENTITY, auth_token: authToken });
        } catch {
          // Token expired — full authorize
          const result = await wallet.authorize({
            identity: APP_IDENTITY,
            cluster: 'mainnet-beta',
          });
          setState(prev => ({ ...prev, authToken: result.auth_token }));
        }
      } else {
        const result = await wallet.authorize({
          identity: APP_IDENTITY,
          cluster: 'mainnet-beta',
        });
        setState(prev => ({
          ...prev,
          authToken: result.auth_token,
          address: result.accounts[0]?.address ?? prev.address,
          isConnected: true,
        }));
      }

      // Sign and send — MWA expects base64-encoded payloads
      const payload = btoa(String.fromCharCode(...serializedTx));
      const result = await wallet.signAndSendTransactions({
        payloads: [payload],
      });

      signature = result.signatures[0] ?? '';
    });

    return signature;
  }, []);

  /**
   * Sign a transaction without sending (returns signed bytes).
   */
  const signTransaction = useCallback(async (serializedTx: Uint8Array): Promise<Uint8Array> => {
    if (!isMobile()) {
      throw new Error('MWA signTransaction is only available on mobile');
    }

    const { transact } = await import('@solana-mobile/mobile-wallet-adapter-protocol');

    let signed: Uint8Array = new Uint8Array();

    await transact(async (wallet: MWAWallet) => {
      const authToken = stateRef.current.authToken;
      if (authToken) {
        try {
          await wallet.reauthorize({ identity: APP_IDENTITY, auth_token: authToken });
        } catch {
          await wallet.authorize({ identity: APP_IDENTITY, cluster: 'mainnet-beta' });
        }
      }

      // MWA expects base64-encoded payloads
      const payload = btoa(String.fromCharCode(...serializedTx));
      const result = await wallet.signTransactions({
        payloads: [payload],
      });

      // Decode base64 signed payload back to Uint8Array
      const signedPayload = result.signed_payloads[0] ?? '';
      signed = signedPayload
        ? Uint8Array.from(atob(signedPayload), c => c.charCodeAt(0))
        : new Uint8Array();
    });

    return signed;
  }, []);

  /**
   * Disconnect — clear local state and cached auth.
   */
  const disconnect = useCallback(() => {
    setState({
      address: null,
      authToken: null,
      isConnected: false,
      balanceSol: 0,
    });
    try {
      sessionStorage.removeItem('mwa-auth-token');
      sessionStorage.removeItem('mwa-address');
    } catch {}
  }, []);

  /**
   * Refresh balance for the connected wallet.
   */
  const refreshBalance = useCallback(async () => {
    const addr = stateRef.current.address;
    if (!addr) return;

    try {
      const balance = await MobileWalletAPI.getBalanceByAddress(addr);
      setState(prev => ({ ...prev, balanceSol: balance }));
    } catch (e) {
      console.warn('[MWA] Balance refresh failed:', e);
    }
  }, []);

  /**
   * Convert current MWA state to WalletInfo for the app store.
   */
  const toWalletInfo = useCallback((): WalletInfo => ({
    address: state.address ?? '',
    balance_sol: state.balanceSol,
    is_connected: state.isConnected,
  }), [state]);

  return {
    ...state,
    connect,
    disconnect,
    signAndSendTransaction,
    signTransaction,
    refreshBalance,
    toWalletInfo,
  };
}
