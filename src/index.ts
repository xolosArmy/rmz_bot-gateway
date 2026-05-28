import "dotenv/config";
import { Telegraf, Context } from "telegraf";
import { getRMZAccessStatus, isValidEcashAddress } from "@xolosarmy/tonalli-core";
import { ChronikAdapter } from "./lib/chronikAdapter.js";
import { getReservedAddressLabel } from "./lib/reservedAddresses.js";
import { ProofOfControlManager } from "./lib/proofOfControl.js";
import { WcBotManager } from "./lib/wcManager.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const chronikUrl = process.env.CHRONIK_URL ?? "https://chronik.xolosarmy.xyz";
const vaultAddress = process.env.GUARDIANIA_VAULT_ADDRESS ?? "ecash:qzdq0q65fwnt94rlcph5kllj0xcry6e0v58zrgp7a3";
const enableAutoApproval = process.env.ENABLE_AUTO_APPROVAL === "true";
const wcProjectId = process.env.WC_PROJECT_ID;

if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN in .env");

const bot = new Telegraf(token);
const adapter = new ChronikAdapter(chronikUrl);
const pocManager = new ProofOfControlManager(vaultAddress, chronikUrl);
let wcManager: WcBotManager | null = null;

if (wcProjectId) {
  wcManager = new WcBotManager();
  await wcManager.init(wcProjectId);
} else {
  console.log("WalletConnect disabled: WC_PROJECT_ID is missing. Running manual-only verification mode.");
}

const pendingJoinRequests = new Map<number, number>();

bot.on("chat_join_request", async (ctx) => {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  pendingJoinRequests.set(userId, chatId);

  try {
    await ctx.telegram.sendMessage(
      userId,
      "🐺 *Alto ahí.*\n\nHas solicitado unirte al grupo oficial de xolosArmy.\nPara entrar, necesitas demostrar que tienes la llave RMZ.\n\nEnvía `/verify` seguido de tu dirección de eCash.\nEjemplo: `/verify ecash:qp...`",
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("No se le pudo enviar DM al usuario.", error);
  }
});

bot.start((ctx) => {
  ctx.reply(
    "🐺 *Guardianía RMZ v0.4-alpha*\n\n" +
    "Use:\n\n" +
    "`/verify ecash:q...`\n\n" +
    (wcManager
      ? "If WalletConnect is enabled, Tonalli Wallet automatic verification will be offered.\nManual `/check` remains available as fallback."
      : "Manual `/check` verification is available."),
    { parse_mode: "Markdown" }
  );
});

async function handleVerify(ctx: Context, address: string) {
  if (ctx.chat?.type !== "private") return;

  if (!isValidEcashAddress(address)) {
    return ctx.reply("❌ La dirección eCash tiene un error tipográfico o es inválida (Falló el checksum Polymod).");
  }

  const reservedLabel = getReservedAddressLabel(address);
  if (reservedLabel) {
    return ctx.reply(
      `⚠️ *Reserved address detected: ${reservedLabel}*\n\nEsta dirección no puede usarse para verificación personal.`,
      { parse_mode: "Markdown" }
    );
  }

  const processingMsg = await ctx.reply("⏳ Consultando la red principal de eCash...");

  try {
    const status = await getRMZAccessStatus(address, adapter);

    if (status === "holder") {
      const userId = ctx.from?.id;
      if (!userId) return;

      const challenge = pocManager.createChallenge(userId, address);
      let response = "";

      if (wcManager) {
        const wcUri = await wcManager.requestMicrotransaction(
          challenge.amountSats,
          challenge.vaultAddress,
          async (txid) => {
            let successResponse = `✅ *Soft Proof-of-Control complete via Tonalli Wallet.*\n\n` +
              `Txid:\n${txid}\n\n` +
              `Tonalli Wallet automated the verification transaction.\n\n` +
              `_Strict input-origin verification will be added in v0.3.1 / v0.4.x._`;

            const pendingChatId = pendingJoinRequests.get(userId);
            if (pendingChatId && enableAutoApproval) {
              try {
                await ctx.telegram.approveChatJoinRequest(pendingChatId, userId);
                successResponse += "\n\n🎉 *Tu solicitud de ingreso al grupo ha sido aprobada.*";
                pendingJoinRequests.delete(userId);
              } catch (err) {
                console.error(err);
                successResponse += "\n\n⚠️ No pude aprobarte en el grupo. Asegúrate de que soy administrador allí.";
              }
            } else if (pendingChatId && !enableAutoApproval) {
              successResponse += "\n\nAuto-approval is currently disabled for safety.";
            }

            pocManager.clearChallenge(userId);
            await ctx.telegram.sendMessage(userId, successResponse, { parse_mode: "Markdown" });
          },
          async () => {
            await ctx.telegram.sendMessage(
              userId,
              `⚠️ *WalletConnect verification failed or was cancelled.*\n\n` +
              `You can still use the manual fallback:\n\n` +
              `/check\n\n` +
              `after sending the exact *${challenge.amountXec} XEC* amount to the Guardianía Vault.`,
              { parse_mode: "Markdown" }
            );
          }
        );

        response = `✅ *RMZ Detected.*\n\n` +
          `Choose one verification method:\n\n` +
          `⚡ *Option A — Tonalli Wallet automatic verification*\n` +
          `Copy this WalletConnect URI and paste it into Tonalli Wallet → WalletConnect:\n\n` +
          "```\n" + wcUri + "\n```\n\n" +
          `Tonalli Wallet will ask you to approve an exact verification transaction.\n\n` +
          `⚙️ *Option B — Manual fallback*\n` +
          `Send exactly *${challenge.amountXec} XEC* to:\n\n` +
          `\`${challenge.vaultAddress}\`\n\n` +
          `Then reply with:\n\n` +
          `/check\n\n` +
          `This challenge expires in 15 minutes.`;
      } else {
        response = `✅ *RMZ Detected.*\n\n` +
          `⚙️ *Manual fallback*\n\n` +
          `Send exactly *${challenge.amountXec} XEC* to:\n\n` +
          `\`${challenge.vaultAddress}\`\n\n` +
          `Then reply with:\n\n` +
          `/check\n\n` +
          `This challenge expires in 15 minutes.`;
      }

      await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, undefined, response, { parse_mode: "Markdown" });
    } else if (status === "non-holder") {
      await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, undefined, "🛑 *Access Denied.*\nNo se detectaron tokens RMZ en esta dirección.", { parse_mode: "Markdown" });
    } else {
      await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, undefined, "⚠️ Error de red al verificar la dirección.");
    }
  } catch (error) {
    await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, undefined, "⚠️ Ocurrió un error inesperado al consultar la blockchain.");
  }
}

async function handleCheck(ctx: Context) {
  if (ctx.chat?.type !== "private") return;

  const userId = ctx.from?.id;
  if (!userId) return;

  const challenge = pocManager.getChallenge(userId);

  if (!challenge) {
    return ctx.reply("❌ No tienes un reto activo. Usa `/verify ecash:qp...` para generar uno.", { parse_mode: "Markdown" });
  }

  if (challenge.status === "expired" || pocManager.isExpired(challenge)) {
    pocManager.clearChallenge(userId);
    return ctx.reply("⏳ Tu reto ha expirado. Por favor, genera uno nuevo.", { parse_mode: "Markdown" });
  }

  const processingMsg = await ctx.reply("⏳ Verificando la bóveda en la blockchain...");

  try {
    const verified = await pocManager.verifyChallenge(challenge);

    if (verified) {
      let response = "✅ *Soft Proof-of-Control complete.*\n\nGuardianía detected the exact verification amount sent to the vault.\n\n_Strict input-origin verification will be added in v0.3.1 / v0.4.x._";
      const pendingChatId = pendingJoinRequests.get(userId);

      if (pendingChatId && enableAutoApproval) {
        try {
          await ctx.telegram.approveChatJoinRequest(pendingChatId, userId);
          response += "\n\n🎉 *Tu solicitud de ingreso al grupo ha sido aprobada.*";
          pendingJoinRequests.delete(userId);
        } catch (err) {
          console.error(err);
          response += "\n\n⚠️ No pude aprobarte en el grupo. Asegúrate de que soy administrador allí.";
        }
      }

      pocManager.clearChallenge(userId);
      await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, undefined, response, { parse_mode: "Markdown" });
    } else {
      await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, undefined, "⏳ *Not found yet.*\n\nWait a few seconds, make sure you sent the exact amount, and try `/check` again.", { parse_mode: "Markdown" });
    }
  } catch (error) {
    await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, undefined, "⚠️ Ocurrió un error al verificar la blockchain.");
  }
}

bot.command("verify", (ctx) => {
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length > 1) {
    return handleVerify(ctx, parts[1]);
  }

  return ctx.reply("❌ Faltan argumentos. Uso: `/verify ecash:qp...`", { parse_mode: "Markdown" });
});

bot.command("check", handleCheck);

bot.launch();
console.log(`🐺 Guardianía Bot v0.4-alpha iniciado. Auto-Approval: ${enableAutoApproval}. WalletConnect: ${wcManager ? "enabled" : "disabled"}`);

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
