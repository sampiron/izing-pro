/* eslint-disable camelcase */
import { Client, LocalAuth, DefaultOptions, Message } from "whatsapp-web.js";
import path from "path";
import { rm } from "fs/promises";
import { getIO } from "./socket";
import Whatsapp from "../models/Whatsapp";
import { logger } from "../utils/logger";
import SyncUnreadMessagesWbot from "../services/WbotServices/SyncUnreadMessagesWbot";
import Queue from "./Queue";
import AppError from "../errors/AppError";
import request from 'request';
const minimalArgs = require('./minimalArgs');

interface Session extends Client {
  id: number;
  checkMessages: any;
}

const sessions: Session[] = [];

const checking: any = {};

export const apagarPastaSessao = async (id: number | string): Promise<void> => {
  const pathRoot = path.resolve(__dirname, "..", "..", ".wwebjs_auth");
  const pathSession = `${pathRoot}/session-wbot-${id}`;
  try {
    await rm(pathSession, { recursive: true, force: true });
  } catch (error) {
    logger.info(`apagarPastaSessao:: ${pathSession}`);
    logger.error(error);
  }
};

export const removeWbot = (whatsappId: number): void => {
  try {
    const sessionIndex = sessions.findIndex(s => s.id === whatsappId);
    if (sessionIndex !== -1) {
      sessions[sessionIndex].destroy();
      sessions.splice(sessionIndex, 1);
    }
  } catch (err) {
    logger.error(`removeWbot | Error: ${err}`);
  }
};

const args: string[] = process.env.CHROME_ARGS
  ? process.env.CHROME_ARGS.split(",")
  : minimalArgs;

args.unshift(`--user-agent=${DefaultOptions.userAgent}`);
const checkMessages = async (wbot: Session, tenantId: number | string) => {
  try {
    const isConnectStatus = wbot && (await wbot.getState()) === "CONNECTED"; // getValue(`wbotStatus-${tenantId}`);
   // logger.info(
   //   "wbot:checkMessages:status",
    //  wbot.id,
    //  tenantId,
     // isConnectStatus
   // );

    if (isConnectStatus) {
   //   logger.info("wbot:connected:checkMessages", wbot, tenantId);
      Queue.add("SendMessages", { sessionId: wbot.id, tenantId });
    }
  } catch (error) {
    const strError = String(error);
    // se a sess�o tiver sido fechada, limpar a checagem de mensagens e bot
    if (strError.indexOf("Session closed.") !== -1) {
      logger.error(
        `BOT Whatsapp desconectado. Tenant: ${tenantId}:: BOT ID: ${wbot.id}`
      );
      clearInterval(wbot.checkMessages);
      removeWbot(wbot.id);
      return;
    }
    logger.error(`ERROR: checkMessages Tenant: ${tenantId}::`, error);
  }
};

export const initWbot = async (whatsapp: Whatsapp): Promise<Session> => {
  return new Promise((resolve, reject) => {
    try {
      const io = getIO();
      const sessionName = whatsapp.name;
      const { tenantId } = whatsapp;
      let sessionCfg;
      if (whatsapp?.session) {
        sessionCfg = JSON.parse(whatsapp.session);
      }

      const wbot = new Client({
        authStrategy: new LocalAuth({ clientId: `wbot-${whatsapp.id}` }),
        takeoverOnConflict: true,
        puppeteer: {
          // headless: false,
          executablePath: process.env.CHROME_BIN || undefined,
          args
        },
        qrMaxRetries: 5
      }) as Session;

      wbot.id = whatsapp.id;

      wbot.initialize();

      wbot.on("qr", async qr => {
        if (whatsapp.status === "CONNECTED") return;
        logger.info(
          `Session QR CODE: ${sessionName}-ID: ${whatsapp.id}-${whatsapp.status}`
        );

        await whatsapp.update({ qrcode: qr, status: "qrcode", retries: 0 });
        const sessionIndex = sessions.findIndex(s => s.id === whatsapp.id);
        if (sessionIndex === -1) {
          wbot.id = whatsapp.id;
          sessions.push(wbot);
        }

        io.emit(`${tenantId}:whatsappSession`, {
          action: "update",
          session: whatsapp
        });
      });

      wbot.on("authenticated", async () => {
        logger.info(`Session: ${sessionName} AUTHENTICATED`);
      });

      wbot.on("auth_failure", async msg => {
        logger.error(
          `Session: ${sessionName}-AUTHENTICATION FAILURE :: ${msg}`
        );
        if (whatsapp.retries > 1) {
          await whatsapp.update({
            retries: 0,
            session: ""
          });
        }

        const retry = whatsapp.retries;
        await whatsapp.update({
          status: "DISCONNECTED",
          retries: retry + 1
        });

        io.emit(`${tenantId}:whatsappSession`, {
          action: "update",
          session: whatsapp
        });
        reject(new Error("Error starting whatsapp session."));
      });

      wbot.on("ready", async () => {
        logger.info(`Session: ${sessionName}-READY`);

        const info: any = wbot?.info;
        const version = await wbot.getWWebVersion();
        console.log(`WWeb v${version}`);
        const wbotBrowser = await wbot.pupBrowser?.version();
        await whatsapp.update({
          status: "CONNECTED",
          qrcode: "",
          retries: 0,
          number: wbot?.info?.wid?.user, // || wbot?.info?.me?.user,
          phone: {
            ...(info || {}),
            wbotBrowser
          }
        });

        io.emit(`${tenantId}:whatsappSession`, {
          action: "update",
          session: whatsapp
        });

        io.emit(`${tenantId}:whatsappSession`, {
          action: "readySession",
          session: whatsapp
        });

        const sessionIndex = sessions.findIndex(s => s.id === whatsapp.id);
        if (sessionIndex === -1) {
          wbot.id = whatsapp.id;
          sessions.push(wbot);
        }

        wbot.sendPresenceAvailable();
        SyncUnreadMessagesWbot(wbot, tenantId);
        resolve(wbot);
      });
      //n8n
      
      if (process.env.N8NSTATUS === 'on') 
      {
        // Variável para armazenar a última mensagem enviada pelo bot
        let lastBotMessage = '';

        // Evento disparado para todas as mensagens enviadas ou recebidas
        wbot.on('message_create', (msg: Message) => {
            if (msg.fromMe) {
                console.log('Mensagem enviada pelo bot:', msg.body);
                // Armazenando a mensagem enviada pelo bot
                lastBotMessage = msg.body;
            }
        });

        wbot.on('message', async (msg: Message) => {
            
          function delay(t: number): Promise<void> {
            return new Promise((resolve) => setTimeout(resolve, t));
          }
          await delay(2000);
          wbot.sendPresenceAvailable();

          await delay(1000);
            
          try {
            // Capturando o ID único da mensagem/conversa recebida
            const messageId = msg.id._serialized;

            const selectedData = {
              from: msg.from,         // Número do remetente
              body: msg.body,         // Conteúdo da mensagem recebida
              timestamp: msg.timestamp, // Data/hora da mensagem recebida
              messageId: messageId,   // ID único da mensagem recebida
              botResponse: lastBotMessage // A última mensagem enviada pelo bot
          };

              const options = {
                  method: 'POST',
                  url: process.env.N8N_WEBHOOK!,
                  headers: {
                      'Content-Type': 'application/json',
                  },
                  json: selectedData,
              };

              request(options, function (error, response) {
                  if (error) {
                      throw new Error(error);
                  } else {
                      console.log(response.body);
                  }
              });
          } catch (e) {
              console.log(e);
          }
        });
      }
    

      wbot.checkMessages = setInterval(
        checkMessages,
        +(process.env.CHECK_INTERVAL || 5000),
        wbot,
        tenantId
      );
      // WhatsappConsumer(tenantId);
    } catch (err) {
      logger.error(`initWbot error | Error: ${err}`);
    }
  });
};

export const getWbot = (whatsappId: number): Session => {
  const sessionIndex = sessions.findIndex(s => s.id === whatsappId);
  if (sessionIndex === -1) {
    throw new AppError("ERR_WAPP_NOT_INITIALIZED");
  }

  return sessions[sessionIndex];
};
