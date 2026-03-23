import { useState, useEffect, useCallback } from "react";

type WalletState = {
  address: `0x${string}` | null;
  isConnected: boolean;
  isConnecting: boolean;
  connect: () => Promise<`0x${string}` | null>;
  disconnect: () => void;
  error: string | null;
};

declare global {
  interface Window {
    ethereum?: any;
  }
}

export function useWallet(): WalletState {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.ethereum) return;
    window.ethereum.request({ method: "eth_accounts" }).then((accounts: string[]) => {
      if (accounts[0]) setAddress(accounts[0] as `0x${string}`);
    });

    const onAccountsChanged = (accounts: string[]) => {
      setAddress(accounts[0] ? (accounts[0] as `0x${string}`) : null);
    };
    window.ethereum.on("accountsChanged", onAccountsChanged);
    return () => window.ethereum?.removeListener("accountsChanged", onAccountsChanged);
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError("No wallet detected. Install MetaMask or a compatible browser wallet.");
      return null;
    }
    setIsConnecting(true);
    setError(null);
    try {
      const accounts: string[] = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (accounts[0]) {
        const next = accounts[0] as `0x${string}`;
        setAddress(next);
        return next;
      }
      return null;
    } catch (err: any) {
      setError(err?.message ?? "Connection rejected");
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
  }, []);

  return {
    address,
    isConnected: !!address,
    isConnecting,
    connect,
    disconnect,
    error,
  };
}
