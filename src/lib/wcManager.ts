import { SignClient } from "@walletconnect/sign-client";

const ECASH_CHAIN_ID = "ecash:1";
const ECASH_METHOD = "ecash_signAndBroadcastTransaction";
const ECASH_METHOD_ALIAS = "ecash_signAndBroadcast";
const APPROVAL_TIMEOUT_MS = 15 * 60 * 1000;

type WalletConnectTxResult = string | {
  txid?: unknown;
  transactionId?: unknown;
  hash?: unknown;
};

export class WcBotManager {
  private client!: InstanceType<typeof SignClient>;

  async init(projectId: string): Promise<void> {
    this.client = await SignClient.init({
      projectId,
      metadata: {
        name: "Guardianía RMZ",
        description: "Acceso seguro a xolosArmy Network",
        url: "https://xolosarmy.xyz",
        icons: ["https://xolosarmy.xyz/favicon.svg"],
      },
    });
  }

  async requestMicrotransaction(
    amountSats: bigint,
    vaultAddress: string,
    onSuccess: (txid: string) => void | Promise<void>,
    onError: (message: string) => void | Promise<void>
  ): Promise<string> {
    const { uri, approval } = await this.client.connect({
      requiredNamespaces: {
        ecash: {
          methods: [ECASH_METHOD, ECASH_METHOD_ALIAS],
          chains: [ECASH_CHAIN_ID],
          events: [],
        },
      },
    });

    if (!uri) {
      throw new Error("WalletConnect did not return a connection URI.");
    }

    void this.runMicrotransactionRequest(
      approval,
      amountSats,
      vaultAddress,
      onSuccess,
      onError
    );

    return uri;
  }

  private async runMicrotransactionRequest(
    approval: () => Promise<{ topic: string }>,
    amountSats: bigint,
    vaultAddress: string,
    onSuccess: (txid: string) => void | Promise<void>,
    onError: (message: string) => void | Promise<void>
  ): Promise<void> {
    let sessionTopic: string | null = null;

    try {
      const session = await withTimeout(
        approval(),
        APPROVAL_TIMEOUT_MS,
        "WalletConnect approval timed out."
      );
      sessionTopic = session.topic;

      const result = await this.client.request<WalletConnectTxResult>({
        topic: session.topic,
        chainId: ECASH_CHAIN_ID,
        request: {
          method: ECASH_METHOD,
          params: {
            mode: "intent",
            outputs: [
              {
                address: vaultAddress,
                valueSats: amountSats.toString(),
              },
            ],
            userPrompt: "Prueba de Control RMZ",
          },
        },
      });

      const txid = extractTxid(result);
      if (!txid) {
        await onError("Tonalli Wallet did not return a txid.");
        return;
      }

      await onSuccess(txid);
    } catch (error) {
      await onError(error instanceof Error ? error.message : "WalletConnect request failed.");
    } finally {
      if (sessionTopic) {
        try {
          await this.client.disconnect({
            topic: sessionTopic,
            reason: {
              code: 6000,
              message: "Guardianía RMZ verification complete.",
            },
          });
        } catch (error) {
          console.error("[WalletConnect] Failed to disconnect session:", error);
        }
      }
    }
  }
}

function extractTxid(result: WalletConnectTxResult): string | null {
  if (typeof result === "string" && result.trim()) return result;
  if (!result || typeof result !== "object") return null;

  for (const key of ["txid", "transactionId", "hash"] as const) {
    const value = result[key];
    if (typeof value === "string" && value.trim()) return value;
  }

  return null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
