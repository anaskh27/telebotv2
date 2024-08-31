require("dotenv").config();
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const { MongoClient } = require("mongodb");
const axios = require("axios");

let User = {};

const initializeUser = async () => {
  User = {
    app: express(),
    bot: new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true }),
    mongoClient: new MongoClient(process.env.MONGODB_URI),
    db: null,
    questions: [
      "What is your family size?",
      "What's your household income?",
      "What's your gender?",
    ],
    userState: {},
  };
};

const connectToMongoDB = async () => {
  try {
    const client = await User.mongoClient.connect();
    User.db = client.db("teleChatBot");
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
};

const setTelegramWebHook = async () => {
  try {
    await User.bot.setWebHook(`${process.env.NGROK_URL}/webhook`);
    console.log("Webhook set");
  } catch (error) {
    console.error("Failed to set webhook:", error);
    throw error;
  }
};

const handleStartCommand = () => {
  User.bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    User.userState[chatId] = 0; 

    const welcomeText = "Hi user, welcome to the bot!";
    User.bot.sendMessage(chatId, welcomeText, {
      reply_to_message_id: msg.message_id,
    });

    User.bot.sendMessage(chatId, User.questions[User.userState[chatId]]);
  });
};

const handleIncomingMessages = async () => {
  User.bot.on("message", async (msg) => {
    const chatId = msg.chat.id;

    if (msg.text === "/start") return;

    const userIndex = User.userState[chatId];
    const userAnswer = msg.text;

    const conversation = {
      userId: chatId,
      question: User.questions[userIndex],
      answer: userAnswer,
    };

    try {
      await User.db.collection("conversations").insertOne(conversation);
      console.log("Conversation saved to MongoDB");

      if (isUnexpectedAnswer(userAnswer)) {
        const chatGptAnswer = await askQuestion(userAnswer);
        User.bot.sendMessage(chatId, `ChatGPT says: ${chatGptAnswer}`);
      }

      if (userIndex < User.questions.length - 1) {
        User.userState[chatId] += 1;
        User.bot.sendMessage(chatId, User.questions[User.userState[chatId]]);
      } else {
        User.bot.sendMessage(
          chatId,
          "Thank you! We have collected all the information we need."
        );
        delete User.userState[chatId];
      }
    } catch (error) {
      console.error("Failed to save conversation:", error);
    }
  });
};

const isUnexpectedAnswer = (answer) => {
  return answer.includes("?");
};

const askQuestion = async (question) => {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: question }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.CHATGPT_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error("Error communicating with ChatGPT:", error);
    return "Sorry, I could not process your request at the moment.";
  }
};

const motherJob = async () => {
  try {
    await initializeUser();
    await connectToMongoDB();
    await setTelegramWebHook();
    handleStartCommand();
    handleIncomingMessages();
  } catch (error) {
    console.error("Error in motherJob:", error);
    await motherJob(); 
  }
};

const app = express();

app.get("/", (req, res) => {
  res.send("Server is running");
});

app.get("/conversations", async (req, res) => {
  try {
    const conversations = await User.db
      .collection("conversations")
      .find()
      .toArray();
    res.json(conversations);
  } catch (err) {
    console.error("Error fetching conversations:", err);
    res.status(500).send("Error fetching conversations");
  }
});

app.listen(3000, () => console.log("Server is running on port 3000"));

motherJob();
