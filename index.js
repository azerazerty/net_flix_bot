require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const User = require("./Models/userModel");
const Order = require("./Models/orderModel");
const cron = require("node-cron");
const validator = require("email-validator");

const { v4: uuidv4, validate: validateUUID } = require("uuid");

const Port = process.env.PORT || 3000;
const Telegram_Token = process.env.TELEGRAM_API_TOKEN;
const MongoDB_URI = process.env.MONGODB_URI;
const FERHAT_API_BASE_URL = process.env.FERHAT_API_BASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;

let PLANS = [
  {
    id: 0,
    plan: "1 Month Subscription",
  },
  {
    id: 1,
    plan: "3 Months Subscription",
  },
  {
    id: 2,
    plan: "6 Months Subscription",
  },
  {
    id: 3,
    plan: "1 Year Subscription",
  },
];

const app = express();
const bot = new TelegramBot(Telegram_Token, { polling: true });

let BOT_WAITING_FOR_RESPONSE = false;

const USERS_STATE = {};

const BUTTONS = ["🔑 Set/Change Api Key", "🔍 Memberships Search"];

// Connect to MongoDB
mongoose
  .connect(MongoDB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Failed to connect to MongoDB", err));

app.use(express.json());
app.use(cors());
//azez

app.get("/", (req, res) => {
  res.send("Hello World!");
});

/// TESTING

const commands = [
  { command: "/start", description: "Start the bot and set API key" },
  {
    command: "/search",
    description: "Search and Check for Membership Status",
  },
  // { command: "/check", description: "Check options" },
  { command: "/help", description: "List all available commands" },
  { command: "/key", description: "Set/Change your API key" },
];

// Handler functions
function handleStartCommand(chatId) {
  //Init User state
  USERS_STATE[chatId] = {};

  // bot.sendMessage(chatId, "Welcome! Please provide your API key:");
  bot.sendMessage(chatId, "Welcome", {
    reply_markup: {
      keyboard: [["🔑 Set/Change Api Key"], ["🔍 Memberships Search"]],
      resize_keyboard: true,

      one_time_keyboard: false,
    },
  });

  // userKeys[chatId] = null; // Initialize user key as null
}

// async function handleFreeFireOffersCommand(chatId) {
//   if (!(await isAuthenticated(chatId))) {
//     bot.sendMessage(chatId, "Please provide your API key first.");
//     return;
//   }
// }

async function handleKeyCommand(chatId) {
  if (!(await isAuthenticated(chatId))) {
    bot.sendMessage(chatId, "Please enter your API key:");
    handleUpdateKey(chatId);
  } else {
    const user = await User.findOne({ chatId });
    bot.sendMessage(
      chatId,
      `Your Current Api key is : \n \`${user.apiKey}\` \n Please enter your new Api Key: `,
      {
        parse_mode: "MARKDOWN",
      }
    );
    handleUpdateKey(chatId);
  }
}

function sendAvailableCommands(chatId) {
  const helpMessage = commands
    .map((cmd) => `${cmd.command} - ${cmd.description}`)
    .join("\n");
  bot.sendMessage(chatId, `Available commands:\n${helpMessage}`);
}

async function isAuthenticated(chatId) {
  const user = await User.findOne({ chatId });
  return user !== null;
}

async function handleUpdateKey(chatId) {
  // Set the user's state to wait for API key input
  USERS_STATE[chatId] = { waitingForApiKey: true };

  const onMessage = async (msg) => {
    // Ensure that we only handle the response for the intended user
    if (msg.chat.id === chatId && USERS_STATE[chatId].waitingForApiKey) {
      const apiKey = msg.text;

      if (validateUUID(apiKey)) {
        // ican hard check for apiKey
        try {
          // await axios.get(`${ICH7EN_API_BASE_URL}/profile`, {
          //   headers: {
          //     "api-token": `${apiKey}`,
          //   },
          // });

          // error her admin can't change his api key
          if (apiKey === ADMIN_KEY) {
            await User.findOneAndUpdate(
              { chatId },
              { apiKey },
              { upsert: true, new: true }
            );
            bot.sendMessage(chatId, "API key updated successfully!");
            sendAvailableCommands(chatId);
            // Clear the user's state and remove the listener after success
            USERS_STATE[chatId] = {};
            bot.removeListener("message", onMessage);
          } else {
            throw new Error("wrong API key");
          }
        } catch (err) {
          console.error("Error saving API key:", err.message);
          bot.sendMessage(chatId, "Failed to save API key. Please try again.");
          // No need to remove the listener, user will try again
        }
      } else {
        bot.sendMessage(
          chatId,
          "Invalid API key format. Please enter a valid API key."
        );
        // No need to remove the listener, user will try again
      }
    }
  };

  // Register the listener for this specific user
  bot.on("message", onMessage);
}

async function handleGetMembership(chatId) {
  if (!(await isAuthenticated(chatId))) {
    bot.sendMessage(chatId, "Please provide your API key first.");
    return;
  }
  // Set user state for waiting for player ID
  USERS_STATE[chatId] = { waitingForEmail: true };

  bot.sendMessage(
    chatId,
    "Enter Email for which Membership you want to see Details:"
  );

  // Create a function to handle user messages
  const handleMessage = async (msg) => {
    if (BUTTONS.includes(msg.text)) {
      bot.removeListener("message", handleMessage); // Remove the listener
      return;
    }
    if (msg.chat.id !== chatId || !USERS_STATE[chatId]?.waitingForEmail) {
      bot.removeListener("message", handleMessage); // Remove the listener
      return;
    }
    //check if its valid email

    if (!validator.validate(msg.text)) {
      bot.sendMessage(chatId, "Wrong Email . Please Enter Valid Email!  ");
      return;
    }
    let email = msg.text;
    //send request to server to grab membership details

    // let result = {
    //   id: 1,
    //   email,
    //   start_date: "2024-11-16",
    //   end_date: "2025-11-16",
    //   membership: "1 Year Membership",
    //   status: "Active",
    // };
    let result = await axios
      .post(`${FERHAT_API_BASE_URL}/search.php`, {
        email,
      })
      .then((r) => r.data?.subscription);
    if (!result) {
      bot.sendMessage(
        chatId,
        `🔴 *Fail* : Cannot Find Any Membership Related to that Email`,
        {
          parse_mode: "MARKDOWN",
        }
      );
      return;
    }
    let statusPoint = "🟡";
    switch (result.status) {
      case "active":
        statusPoint = "🟢";
        break;
      case "expired":
        statusPoint = "🔴";
        break;
      default:
        break;
    }
    bot.sendMessage(
      chatId,
      `*Membership Found:* ${result.email} \n\n
      *STATUS:*  ${statusPoint}  *${result.status.toUpperCase()}*\n\n 
      🏷️ _Plan:_  \`${PLANS[result?.membership].plan || "UNKNOWN PLAN"}\`\n 
      📆 _Start Date:_  \`${result.start_date}\`\n
      📆 _End Date:_  \`${result.end_date}\`\n
      \n\n                   
                      `,
      {
        parse_mode: "MARKDOWN",
      }
    );
    bot.removeListener("message", handleMessage); // Remove the listener
  };

  bot.on("message", handleMessage);
}

async function notifyAdmin(_Memberships) {
  //search for users and send updates
  try {
    let ExpiredSubs = await axios
      .get(`${FERHAT_API_BASE_URL}/notification.php`)
      .then((r) => r.data?.Expired_subscriptions);
    if (!ExpiredSubs || ExpiredSubs.length < 1) return;
    let users = await User.find();
    if (users && users.length > 0) {
      users.map((user) => {
        // let result = {
        //   id: 1,
        //   email: "test@test.com",
        //   start_date: "2024-11-16",
        //   end_date: "2025-11-16",
        //   membership: "1 Year Membership",
        //   status: "Active",
        // };
        ExpiredSubs.map((ExpiredSub) => {
          bot.sendMessage(
            user.chatId,
            `
            🚨 *Membership Expired:* 🚨 ${ExpiredSub?.email} \n\n
            🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨\n
            🏷️ _Plan:_  \`${
              PLANS[ExpiredSub?.membership] || "UNKNOWN PLAN"
            }\`\n 
            📆 _Start Date:_  \`${ExpiredSub?.start_date}\`\n
            📆 _End Date:_  \`${ExpiredSub?.end_date}\`\n
            🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨\n\n                   
                            `,
            {
              parse_mode: "MARKDOWN",
            }
          );
        });
      });
    }
  } catch (error) {
    console.log(error);
  }
}

// Command handlers
bot.onText(/\/start/, (msg) => {
  // BOT_WAITING_FOR_RESPONSE = false;
  handleStartCommand(msg.chat.id);
});

bot.onText(/\/search/, (msg) => {
  // BOT_WAITING_FOR_RESPONSE = false;
  const chatId = msg.chat.id;
  USERS_STATE[chatId] = {};
  handleGetMembership(chatId);
});

bot.onText(/\/help/, (msg) => {
  // BOT_WAITING_FOR_RESPONSE = false;
  const chatId = msg.chat.id;
  USERS_STATE[chatId] = {};
  const helpMessage = commands
    .map((cmd) => `${cmd.command} - ${cmd.description}`)
    .join("\n");
  bot.sendMessage(chatId, helpMessage);
});

bot.onText(/\/key/, async (msg) => {
  // BOT_WAITING_FOR_RESPONSE = false;
  const chatId = msg.chat.id;
  USERS_STATE[chatId] = {};

  handleKeyCommand(chatId);
});

// Callback query handler
// bot.on("callback_query", (query) => {
//   const chatId = query.message.chat.id;
//   const data = query.data.split("_");
//   const command = data[0];
//   const action = data[1];
//   const game = data[2];
//   const id = data[3];

//   switch (command) {
//     case "offer":
//       if (action === "select") {
//         if (Object.keys(USERS_STATE[chatId]).length > 0) return;
//         handleOfferSelection(chatId, id, game);
//       }
//       break;
//     case "order":
//       if (action === "select") {
//         CheckOrder(chatId, id);
//       }
//       break;
//     case "confirm":
//       break;
//     default:
//       bot.sendMessage(chatId, "Invalid selection.");
//       break;
//   }
// });

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  if (!msg.text.startsWith("/")) {
    if (msg.text.indexOf("🔍 Memberships Search") === 0) {
      // BOT_WAITING_FOR_RESPONSE = false;
      USERS_STATE[chatId] = {};

      handleGetMembership(chatId);

      return;
    }
    ///
    if (msg.text.indexOf("🔑 Set/Change Api Key") === 0) {
      // BOT_WAITING_FOR_RESPONSE = false;
      USERS_STATE[chatId] = {};
      handleKeyCommand(chatId);
    }
  }
});

///THIS IS ADDED TO PREVENT RENDER FROM SPINNING OFF
function reloadWebsite() {
  const url = `https://ich7en-automated-telegram-bot.onrender.com/`; // Replace with your Render URL
  const interval = 30000; // Interval in milliseconds (30 seconds)
  axios
    .get(url)
    .then((response) => {
      console.log(
        `Reloaded at ${new Date().toISOString()}: Status Code ${
          response.status
        }`
      );
    })
    .catch((error) => {
      console.error(
        `Error reloading at ${new Date().toISOString()}:`,
        error.message
      );
    });
}

cron.schedule("0 * * * *", () => {
  notifyAdmin();
});

app.listen(Port, () => {
  console.log(`App listening on port ${Port}`);
});
