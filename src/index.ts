import "dotenv/config";
import { Telegraf } from "telegraf";
import { getRMZAccessStatus, isValidEcashAddress } from "@xolosarmy/tonalli-core";
import { ChronikAdapter } from "./lib/chronikAdapter.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const chronikUrl = process.env.CHRONIK_URL ?? "https://chronik.e.cash";

if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN in .env");

const bot = new Telegraf(token);
const adapter = new ChronikAdapter(chronikUrl);

// Memoria en caché para rastrear quién solicita entrar a qué grupo (userId -> chatId)
const pendingJoinRequests = new Map<number, number>();

// 1. Escuchar cuando alguien pide unirse al grupo
bot.on("chat_join_request", async (ctx) => {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  // Guardamos la solicitud en memoria
  pendingJoinRequests.set(userId, chatId);

  // Le mandamos un mensaje privado al usuario
  try {
    await ctx.telegram.sendMessage(
      userId,
      "🐺 *Alto ahí.*\n\nHas solicitado unirte al grupo oficial de xolosArmy.\nPara entrar, necesitas demostrar que tienes la llave RMZ.\n\nPor favor, envíame tu dirección de eCash que contenga los tokens.\n*(Debe empezar con ecash:)*",
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("No se le pudo enviar DM al usuario. Probablemente no ha iniciado el bot.", error);
  }
});

bot.start((ctx) => {
  ctx.reply(
    "🐺 *Bienvenido a la Guardianía RMZ.*\n\n" +
    "Si solicitaste unirte al grupo, envíame tu dirección de eCash para verificar tu acceso.\n\n" +
    "*(Debe empezar con ecash:)*",
    { parse_mode: "Markdown" }
  );
});

bot.on("text", async (ctx) => {
  // Ignorar mensajes si no son en chat privado
  if (ctx.chat.type !== 'private') return;

  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;

  if (!text.startsWith("ecash:")) {
    return ctx.reply("❌ Formato inválido. Por favor envía una dirección que comience con 'ecash:'.");
  }

  if (!isValidEcashAddress(text)) {
    return ctx.reply("❌ La dirección eCash tiene un error tipográfico o es inválida (Falló el checksum Polymod).");
  }

  const processingMsg = await ctx.reply("⏳ Consultando la red principal de eCash...");

  try {
    const status = await getRMZAccessStatus(text, adapter);
    const userId = ctx.from.id;
    const pendingChatId = pendingJoinRequests.get(userId);
    
    if (status === "holder") {
      let response = "✅ *Access Granted.*\nEres portador de la llave RMZ.";
      
      // Si el usuario tiene una solicitud pendiente, lo aprobamos en el grupo
      if (pendingChatId) {
        try {
          await ctx.telegram.approveChatJoinRequest(pendingChatId, userId);
          response += "\n\n🎉 *Tu solicitud de ingreso al grupo ha sido aprobada.* ¡Bienvenido a la trinchera!";
          pendingJoinRequests.delete(userId); // Limpiar memoria
        } catch (err) {
          console.error(err);
          response += "\n\n⚠️ No pude aprobarte en el grupo. Asegúrate de que soy administrador allí.";
        }
      } else {
         response += "\n\n*(No tienes ninguna solicitud de ingreso pendiente en este momento)*";
      }

      await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, undefined, response, { parse_mode: "Markdown" });

    } else if (status === "non-holder") {
      let response = "🛑 *Access Denied.*\nNo se detectaron tokens RMZ en esta dirección.";
      
      // Rechazar la solicitud formalmente
      if (pendingChatId) {
         try {
            await ctx.telegram.declineChatJoinRequest(pendingChatId, userId);
            response += "\n\n❌ Tu solicitud para unirte al grupo ha sido rechazada.";
            pendingJoinRequests.delete(userId);
         } catch(err){}
      }
      await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, undefined, response, { parse_mode: "Markdown" });
    } else {
      await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, undefined, "⚠️ Error de red al verificar la dirección.");
    }

  } catch (error) {
    await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, undefined, "⚠️ Ocurrió un error inesperado al consultar la blockchain.");
  }
});

bot.launch();
console.log("🐺 Guardianía Bot iniciado y escuchando solicitudes de ingreso...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
