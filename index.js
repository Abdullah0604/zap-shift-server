const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.aq5ggi6.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("parcelDelivery");
    const parcelsCollection = db.collection("parcels");

    // ✅ GET all parcels
    app.get("/parcels", async (req, res) => {
      try {
        const parcels = await parcelsCollection.find().toArray();
        res.status(200).json(parcels);
      } catch (err) {
        res.status(500).json({ error: "Failed to fetch parcels" });
      }
    });

    // ✅ POST new parcel (Send Parcel)
    app.post("/parcels", async (req, res) => {
      try {
        const parcel = req.body;
        const result = await parcelsCollection.insertOne(parcel);
        res.status(201).send(result);
      } catch (err) {
        res.status(500).json({ error: "Failed to store parcel" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// Routes

// Root Route
app.get("/", (req, res) => {
  res.send("Parcel Delivery Server is Running 🚚");
});

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
