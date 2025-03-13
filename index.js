const express = require("express");
const { Kafka } = require("kafkajs");

const app = express();
const PORT = 3000;
const kafka = new Kafka({ brokers: ["localhost:9092"] });

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: "trip-group" });
let consumedMessages = []; // Store consumed messages in-memory

app.use(express.json());

// ✅ Produce Kafka Event API
app.post("/produce", async (req, res) => {
    const { topic, message } = req.body;
    if (!topic || !message) return res.status(400).json({ error: "Topic and message are required!" });

    try {
        await producer.connect();
        await producer.send({ topic, messages: [{ value: message }] });
        await producer.disconnect();
        res.json({ status: "Message sent to Kafka", topic, message });
    } catch (error) {
        console.error("Producer error:", error);
        res.status(500).json({ error: "Failed to send message" });
    }
});

// ✅ GET API to Fetch Consumed Messages
app.get("/consume", async (req, res) => {
    res.json({ processedMessages: consumedMessages });
});

// ✅ Kafka Consumer (Runs in Background)
const startConsumer = async () => {
    await consumer.connect();
    await consumer.subscribe({ topic: "tripUpdates", fromBeginning: true });

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            const msg = message.value.toString();
            console.log(`Consumed: ${msg}`);
            consumedMessages.push({ topic, partition, message: msg });

            // Optional: Remove old messages to prevent memory overflow
            if (consumedMessages.length > 100) consumedMessages.shift();
        },
    });
};

// ✅ GET API to Check Kafka Consumer Lag
app.get("/lag", async (req, res) => {
    const { topic, groupId } = req.query;
    if (!topic || !groupId) return res.status(400).json({ error: "Topic and groupId are required!" });

    try {
        const admin = kafka.admin();
        await admin.connect();

        // Get latest offsets from Kafka
        const topicOffsets = await admin.fetchTopicOffsets(topic);

        // Get consumer group offsets
        const groupOffsets = await admin.fetchOffsets({ groupId, topics: [topic] });

        await admin.disconnect();

        // Calculate lag for each partition
        let lagInfo = topicOffsets.map(({ partition, offset }) => {
            const consumerOffset = groupOffsets[0].partitions.find(p => p.partition === partition)?.offset || "0";
            const lag = parseInt(offset) - parseInt(consumerOffset);
            return { partition, logEndOffset: offset, consumerOffset, lag };
        });

        res.json({ topic, groupId, lagInfo });
    } catch (error) {
        console.error("Lag check error:", error);
        res.status(500).json({ error: "Failed to get lag information" });
    }
});

// Start Server & Consumer
app.listen(PORT, async () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    await startConsumer();
});
