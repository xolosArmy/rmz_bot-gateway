import { ChronikClient } from "chronik-client";
import type { BlockchainAdapter, TokenBalance } from "@xolosarmy/tonalli-core";

type ChronikUtxo = {
  token?: {
    tokenId?: string;
    amount?: string | bigint;
    atoms?: string | bigint;
  };
  slpToken?: {
    amount?: string | bigint;
  };
  slpMeta?: {
    tokenId?: string;
  };
};

type ChronikScriptUtxos = {
  utxos: ChronikUtxo[];
};

type ChronikUtxosResponse =
  | ChronikScriptUtxos[]
  | {
      scriptUtxos?: ChronikScriptUtxos[];
      utxos?: ChronikUtxo[];
    };

export class ChronikAdapter implements BlockchainAdapter {
  private chronik: ChronikClient;

  constructor(chronikUrl: string) {
    this.chronik = new ChronikClient([chronikUrl]);
  }

  async getTokenBalance(
    address: string,
    tokenId: string
  ): Promise<TokenBalance | null> {
    const result = (await this.chronik.address(address).utxos()) as ChronikUtxosResponse;

    const scriptUtxos: ChronikScriptUtxos[] = Array.isArray(result)
      ? result
      : Array.isArray(result.scriptUtxos)
        ? result.scriptUtxos
        : Array.isArray(result.utxos)
          ? [{ utxos: result.utxos }]
          : [];

    let totalAmount = 0n;

    for (const scriptUtxo of scriptUtxos) {
      for (const utxo of scriptUtxo.utxos) {
        const foundTokenId = utxo.token?.tokenId ?? utxo.slpMeta?.tokenId;
        const foundAmount =
          utxo.token?.atoms ??
          utxo.token?.amount ??
          utxo.slpToken?.amount;

        if (foundTokenId === tokenId && foundAmount !== undefined) {
          totalAmount += BigInt(foundAmount);
        }
      }
    }

    if (totalAmount === 0n) {
      return null;
    }

    return {
      tokenId,
      amount: totalAmount.toString()
    };
  }
}
