import "dotenv/config";
import { Telegraf, Context } from "telegraf";
import { getRMZAccessStatus, isValidEcashAddress } from "@xolosarmy/tonalli-core";
import { ChronikAdapter } from "./lib/chronikAdapter.js";
import { getReservedAddressLabel } from "./lib/reservedAddresses.js";
import { ProofOfControlManager } from "./lib/proofOfControl.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const chronikUrl = process.env.CHRONIK_URL ?? "https://chronik.xolosarmy.xyz";
const vaultAddress = process.env.GUARDIANIA_VAULT_ADDRESS ?? "ecash:qzdq0q65fwnt94rlcph5kllj0xcry6e0v58zrgp7a3";
const enableAutoApproval = process.env.ENABLE_AUTO_APPROVAL === "true";

if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN in .env");

const bot = new Telegraf(token);
const adapter = new ChronikAdapter(chronikUrl);
const pocManager = new ProofOfControlManager(vaultAddress, chronikUrl);

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
    "🐺 *Bienvenido a la Guardianía RMZ (v0.3 - Soft Proof).*\n\n" +
    "Usa el comando `/verify` seguido de tu dirección de eCash.\n\n" +
    "Ejemplo: `/verify ecash:qp...`",
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
      const response = `✅ *RMZ Detected.*\n\n` +
        `Now prove your intent.\n\n` +
        `Send exactly *${challenge.amountXec} XEC* from Tonalli Wallet to:\n\n` +
        `\`${challenge.vaultAddress}\`\n\n` +
        `*Important:*\n` +
        `- Send from the same address you submitted.\n` +
        `- This challenge expires in 15 minutes.\n\n` +
        `After sending, reply with \`/check\`.`;

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
      let response = "✅ *Soft Proof-of-Control complete.*\n\nGuardianía detected the exact verification amount sent to the vault.\n\n_Note: strict input-origin verification will be added in v0.3.1._";
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
console.log(`🐺 Guardianía Bot v0.3 (Soft Proof) iniciado. Auto-Approval: ${enableAutoApproval}`);

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
