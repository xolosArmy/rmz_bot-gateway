import { ChronikClient } from "chronik-client";

export type ProofChallenge = {
  telegramUserId: number;
  address: string;
  amountXec: string;
  amountSats: bigint;
  vaultAddress: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "verified" | "expired";
};

type ChronikOutput = {
  value?: string | bigint;
};

type ChronikTx = {
  outputs?: ChronikOutput[];
  timeFirstSeen?: number;
};

type ChronikHistory = {
  txs?: ChronikTx[];
};

export class ProofOfControlManager {
  private challenges: Map<number, ProofChallenge> = new Map();
  private vaultAddress: string;
  private chronik: ChronikClient;

  constructor(vaultAddress: string, chronikUrl: string = "https://chronik.e.cash") {
    this.vaultAddress = vaultAddress;
    this.chronik = new ChronikClient([chronikUrl]);
  }

  createChallenge(telegramUserId: number, address: string): ProofChallenge {
    let amountXec = "";
    let amountSats = 0n;
    let isUnique = false;

    while (!isUnique) {
      const randomSats = Math.floor(Math.random() * 500) + 500;
      amountXec = (randomSats / 100).toFixed(2);
      amountSats = BigInt(randomSats);

      isUnique = true;
      for (const challenge of this.challenges.values()) {
        if (challenge.amountSats === amountSats && challenge.status === "pending") {
          isUnique = false;
          break;
        }
      }
    }

    const now = Date.now();
    const challenge: ProofChallenge = {
      telegramUserId,
      address,
      amountXec,
      amountSats,
      vaultAddress: this.vaultAddress,
      createdAt: now,
      expiresAt: now + 15 * 60 * 1000,
      status: "pending",
    };

    this.challenges.set(telegramUserId, challenge);
    return challenge;
  }

  getChallenge(telegramUserId: number): ProofChallenge | null {
    const challenge = this.challenges.get(telegramUserId);
    if (!challenge) return null;
    if (this.isExpired(challenge)) challenge.status = "expired";
    return challenge;
  }

  clearChallenge(telegramUserId: number): void {
    this.challenges.delete(telegramUserId);
  }

  isExpired(challenge: ProofChallenge): boolean {
    return Date.now() > challenge.expiresAt;
  }

  async verifyChallenge(challenge: ProofChallenge): Promise<boolean> {
    if (this.isExpired(challenge)) {
      challenge.status = "expired";
      return false;
    }

    try {
      const history = await this.chronik.address(this.vaultAddress).history(0, 50) as ChronikHistory;

      for (const tx of history.txs ?? []) {
        const foundMatchingOutput = (tx.outputs ?? []).some(
          (output) => output.value?.toString() === challenge.amountSats.toString()
        );
        const txTimeMs = tx.timeFirstSeen && tx.timeFirstSeen !== 0 ? tx.timeFirstSeen * 1000 : 0;

        // TODO (v0.3.1): verify the tx input origin strictly before treating this as proof of control.
        if (foundMatchingOutput && (txTimeMs === 0 || txTimeMs >= challenge.createdAt - 60000)) {
          challenge.status = "verified";
          return true;
        }
      }
    } catch (error) {
      console.error("[ProofOfControl] Error verifying challenge:", error);
    }

    return false;
  }
}
